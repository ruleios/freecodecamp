var _ = require('lodash'),
    async = require('async'),
    crypto = require('crypto'),
    nodemailer = require('nodemailer'),
    moment = require('moment'),
    // debug = require('debug')('freecc:cntr:userController'),

    secrets = require('../../config/secrets');

function calcCurrentStreak(cals) {
  const revCals = cals.slice().reverse();
  let streakBroken = false;
  return revCals
    .reduce((current, cal, index) => {
      // if streak not borken and diff between this cal and the call after it
      // is equal to zero
      // moment.diff will return the days between rounded down
      if (
        !streakBroken &&
        moment(revCals[index === 0 ? 0 : index - 1]).diff(cal, 'days') === 0
      ) {
        return current + 1;
      }
      return 1;
    }, 1);
}

module.exports = function(app) {
  var router = app.loopback.Router();
  var User = app.models.User;
  var Story = app.models.Story;

  router.get('/login', function(req, res) {
    res.redirect(301, '/signin');
  });
  router.get('/logout', function(req, res) {
    res.redirect(301, '/signout');
  });
  router.get('/signin', getSignin);
  router.get('/signout', signout);
  router.get('/forgot', getForgot);
  router.post('/forgot', postForgot);
  router.get('/reset/:token', getReset);
  router.post('/reset/:token', postReset);
  router.get('/email-signup', getEmailSignup);
  router.get('/email-signin', getEmailSignin);

  router.get('/account/api', getAccountAngular);
  router.post('/account/profile', postUpdateProfile);
  router.post('/account/password', postUpdatePassword);
  router.post('/account/delete', postDeleteAccount);
  router.get('/account/unlink/:provider', getOauthUnlink);
  router.get('/account', getAccount);
  // Ensure this is the last route!
  router.get('/:username', returnUser);

  app.use(router);

  function getSignin(req, res) {
    if (req.user) {
      return res.redirect('/');
    }
    res.render('account/signin', {
      title: 'Free Code Camp Login'
    });
  }

  function signout(req, res) {
    req.logout();
    res.redirect('/');
  }

  function getEmailSignin(req, res) {
    if (req.user) {
      return res.redirect('/');
    }
    res.render('account/email-signin', {
      title: 'Sign in to your Free Code Camp Account'
    });
  }

  function getEmailSignup(req, res) {
    if (req.user) {
      return res.redirect('/');
    }
    res.render('account/email-signup', {
      title: 'Create Your Free Code Camp Account'
    });
  }

  function getAccount(req, res) {
    if (!req.user) {
      return res.redirect('/');
    }
    res.render('account/account', {
      title: 'Manage your Free Code Camp Account'
    });
  }

  function getAccountAngular(req, res) {
    res.json({
      user: req.user || {}
    });
  }

  function returnUser(req, res, next) {
    const username = req.params.username.toLowerCase();
    const { path } = req;
    User.findOne(
      { where: { username } },
      function(err, user) {
        if (err) {
          return next(err);
        }
        if (!user) {
          req.flash('errors', {
            msg: `404: We couldn't find path ${ path }`
          });
          return res.redirect('/');
        }
        if (!user.isGithubCool && !user.isMigrationGrandfathered) {
          req.flash('errors', {
            msg: `
              user ${ username } has not completed account signup
            `
          });
          return res.redirect('/');
        }

        var cals = user
          .progressTimestamps
          .map(objOrNum => {
            return typeof objOrNum === 'number' ?
              objOrNum :
              objOrNum.timestamp;
          })
          .map(time => {
            return moment(time).format('YYYY-MM-DD');
          });

        user.currentStreak = calcCurrentStreak(cals);

        if (user.currentStreak > user.longestStreak) {
          user.longestStreak = user.currentStreak;
        }

        const data = user
          .progressTimestamps
          .map((objOrNum) => {
            return typeof objOrNum === 'number' ?
              objOrNum :
              objOrNum.timestamp;
          })
          .reduce((data, timeStamp) => {
            data[(timeStamp / 1000)] = 1;
            return data;
          }, {});

        const challenges = user.completedChallenges.filter(function(obj) {
          return obj.challengeType === 3 || obj.challengeType === 4;
        });

        res.render('account/show', {
          title: 'Camper ' + user.username + '\'s portfolio',
          username: user.username,
          name: user.name,
          isMigrationGrandfathered: user.isMigrationGrandfathered,
          isGithubCool: user.isGithubCool,
          location: user.location,
          githubProfile: user.githubProfile,
          linkedinProfile: user.linkedinProfile,
          codepenProfile: user.codepenProfile,
          facebookProfile: user.facebookProfile,
          twitterHandle: user.twitterHandle,
          bio: user.bio,
          picture: user.picture,
          progressTimestamps: user.progressTimestamps,
          calender: data,
          challenges: challenges,
          moment: moment,
          longestStreak: user.longestStreak,
          currentStreak: user.currentStreak
        });
      }
    );
  }

  /**
  * POST /account/profile
  * Update profile information.
  */

  function postUpdateProfile(req, res, next) {

    User.findById(req.user.id, function(err) {
      if (err) { return next(err); }
      var errors = req.validationErrors();
      if (errors) {
        req.flash('errors', errors);
        return res.redirect('/account');
      }

      User.findOne({
        where: { email: req.body.email }
      }, function(err, existingEmail) {
        if (err) {
          return next(err);
        }
        var user = req.user;
        if (existingEmail && existingEmail.email !== user.email) {
          req.flash('errors', {
            msg: 'An account with that email address already exists.'
          });
          return res.redirect('/account');
        }
        User.findOne(
          { where: { username: req.body.username } },
          function(err, existingUsername) {
            if (err) {
              return next(err);
            }
            var user = req.user;
            if (
              existingUsername &&
              existingUsername.username !== user.username
            ) {
              req.flash('errors', {
                msg: 'An account with that username already exists.'
              });
              return res.redirect('/account');
            }
            var body = req.body || {};
            user.facebookProfile = body.facebookProfile.trim() || '';
            user.linkedinProfile = body.linkedinProfile.trim() || '';
            user.codepenProfile = body.codepenProfile.trim() || '';
            user.twitterHandle = body.twitterHandle.trim() || '';
            user.bio = body.bio.trim() || '';

            user.save(function(err) {
              if (err) {
                return next(err);
              }
              updateUserStoryPictures(
                user.id.toString(),
                user.picture,
                user.username,
                function(err) {
                  if (err) { return next(err); }
                  req.flash('success', {
                    msg: 'Profile information updated.'
                  });
                  res.redirect('/account');
                }
              );
            });
          }
        );
      });
    });
  }

  /**
  * POST /account/password
  * Update current password.
  */

  function postUpdatePassword(req, res, next) {
    req.assert('password', 'Password must be at least 4 characters long')
      .len(4);

    req.assert('confirmPassword', 'Passwords do not match')
      .equals(req.body.password);

    var errors = req.validationErrors();

    if (errors) {
      req.flash('errors', errors);
      return res.redirect('/account');
    }

    User.findById(req.user.id, function(err, user) {
      if (err) { return next(err); }

      user.password = req.body.password;

      user.save(function(err) {
        if (err) { return next(err); }

        req.flash('success', { msg: 'Password has been changed.' });
        res.redirect('/account');
      });
    });
  }

  /**
  * POST /account/delete
  * Delete user account.
  */

  function postDeleteAccount(req, res, next) {
    User.destroyById(req.user.id, function(err) {
      if (err) { return next(err); }
      req.logout();
      req.flash('info', { msg: 'Your account has been deleted.' });
      res.redirect('/');
    });
  }

  /**
  * GET /account/unlink/:provider
  * Unlink OAuth provider.
  */

  function getOauthUnlink(req, res, next) {
    var provider = req.params.provider;
    User.findById(req.user.id, function(err, user) {
      if (err) { return next(err); }

      user[provider] = null;
      user.tokens =
        _.reject(user.tokens, function(token) {
          return token.kind === provider;
        });

      user.save(function(err) {
        if (err) { return next(err); }
        req.flash('info', { msg: provider + ' account has been unlinked.' });
        res.redirect('/account');
      });
    });
  }

  /**
  * GET /reset/:token
  * Reset Password page.
  */

  function getReset(req, res, next) {
    if (req.isAuthenticated()) {
      return res.redirect('/');
    }
    User.findOne(
      {
        where: {
          resetPasswordToken: req.params.token,
          resetPasswordExpires: { gte: Date.now() }
        }
      },
      function(err, user) {
        if (err) { return next(err); }
        if (!user) {
          req.flash('errors', {
            msg: 'Password reset token is invalid or has expired.'
          });
          return res.redirect('/forgot');
        }
        res.render('account/reset', {
          title: 'Password Reset',
          token: req.params.token
        });
      });
  }

  /**
  * POST /reset/:token
  * Process the reset password request.
  */

  function postReset(req, res, next) {
    var errors = req.validationErrors();

    if (errors) {
      req.flash('errors', errors);
      return res.redirect('back');
    }

    async.waterfall([
      function(done) {
        User.findOne(
          {
            where: {
              resetPasswordToken: req.params.token,
              resetPasswordExpires: { gte: Date.now() }
            }
          },
          function(err, user) {
            if (err) { return next(err); }
            if (!user) {
              req.flash('errors', {
                msg: 'Password reset token is invalid or has expired.'
              });
              return res.redirect('back');
            }

            user.password = req.body.password;
            user.resetPasswordToken = null;
            user.resetPasswordExpires = null;

            user.save(function(err) {
              if (err) { return done(err); }
              req.logIn(user, function(err) {
                done(err, user);
              });
            });
          });
      },
      function(user, done) {
        var transporter = nodemailer.createTransport({
          service: 'Mandrill',
          auth: {
            user: secrets.mandrill.user,
            pass: secrets.mandrill.password
          }
        });
        var mailOptions = {
          to: user.email,
          from: 'Team@freecodecamp.com',
          subject: 'Your Free Code Camp password has been changed',
          text: [
            'Hello,\n\n',
            'This email is confirming that you requested to',
            'reset your password for your Free Code Camp account.',
            'This is your email:',
            user.email,
            '\n'
          ].join(' ')
        };
        transporter.sendMail(mailOptions, function(err) {
          if (err) { return done(err); }
          req.flash('success', {
            msg: 'Success! Your password has been changed.'
          });
          done();
        });
      }
    ], function(err) {
      if (err) { return next(err); }
      res.redirect('/');
    });
  }

  /**
  * GET /forgot
  * Forgot Password page.
  */

  function getForgot(req, res) {
    if (req.isAuthenticated()) {
      return res.redirect('/');
    }
    res.render('account/forgot', {
      title: 'Forgot Password'
    });
  }

  /**
  * POST /forgot
  * Create a random token, then the send user an email with a reset link.
  */

  function postForgot(req, res, next) {
    var errors = req.validationErrors();

    if (errors) {
      req.flash('errors', errors);
      return res.redirect('/forgot');
    }

    async.waterfall([
      function(done) {
        crypto.randomBytes(16, function(err, buf) {
          if (err) { return done(err); }
          var token = buf.toString('hex');
          done(null, token);
        });
      },
      function(token, done) {
        User.findOne({
          where: { email: req.body.email.toLowerCase() }
        }, function(err, user) {
          if (err) { return done(err); }
          if (!user) {
            req.flash('errors', {
              msg: 'No account with that email address exists.'
            });
            return res.redirect('/forgot');
          }

          user.resetPasswordToken = token;
          // 3600000 = 1 hour
          user.resetPasswordExpires = Date.now() + 3600000;

          user.save(function(err) {
            if (err) { return done(err); }
            done(null, token, user);
          });
        });
      },
      function(token, user, done) {
        var transporter = nodemailer.createTransport({
          service: 'Mandrill',
          auth: {
            user: secrets.mandrill.user,
            pass: secrets.mandrill.password
          }
        });
        var mailOptions = {
          to: user.email,
          from: 'Team@freecodecamp.com',
          subject: 'Reset your Free Code Camp password',
          text: [
            'You are receiving this email because you (or someone else)\n',
            'requested we reset your Free Code Camp account\'s password.\n\n',
            'Please click on the following link, or paste this into your\n',
            'browser to complete the process:\n\n',
            'http://',
            req.headers.host,
            '/reset/',
            token,
            '\n\n',
            'If you did not request this, please ignore this email and\n',
            'your password will remain unchanged.\n'
          ].join('')
        };
        transporter.sendMail(mailOptions, function(err) {
          if (err) { return done(err); }
          req.flash('info', {
            msg: 'An e-mail has been sent to ' +
            user.email +
            ' with further instructions.'
          });
          done(null, 'done');
        });
      }
    ], function(err) {
      if (err) { return next(err); }
      res.redirect('/forgot');
    });
  }

  function updateUserStoryPictures(userId, picture, username, cb) {
    Story.find({ 'author.userId': userId }, function(err, stories) {
      if (err) { return cb(err); }

      const tasks = [];
      stories.forEach(function(story) {
        story.author.picture = picture;
        story.author.username = username;
        tasks.push(function(cb) {
          story.save(cb);
        });
      });
      async.parallel(tasks, function(err) {
        if (err) {
          return cb(err);
        }
        cb();
      });
    });
  }
};
