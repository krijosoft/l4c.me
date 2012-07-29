// Generated by CoffeeScript 1.3.3
var config, delay, die, fs, get_new_emails, helpers, imap, invoke, mailparser, model, mongo_session, mongoose, nodejs_path, server, spawn, underscore, _;

_ = underscore = require("underscore");

_.str = underscore.str = require("underscore.string");

invoke = require("invoke");

imap = require("imap").ImapConnection;

mailparser = require("mailparser").MailParser;

fs = require("fs");

nodejs_path = require("path");

spawn = require('child_process').spawn;

config = require("../config.json");

helpers = require("../build/lib/helpers");

delay = 1 * 60 * 1000;

mongo_session = require('connect-mongo');

mongoose = require('mongoose');

mongoose.connect(config.mongodb.app);

model = {
  user: require("../build/models/user"),
  photo: require("../build/models/photo")
};

server = new imap({
  username: config.mailer.username,
  password: config.mailer.password,
  host: config.mailer.imap.host,
  port: config.mailer.imap.port,
  secure: config.mailer.imap.secure
});

die = function(err) {
  console.error('dead server');
  return process.exit(1);
};

server.connect(function(err) {
  if (err) {
    return die(err);
  }
  return server.openBox('INBOX', false, function(err, box) {
    if (err) {
      return die(err);
    }
    return get_new_emails(server);
  });
});

get_new_emails = function(server) {
  var processed_emails, tmp_dir, total_emails, upload_photo;
  total_emails = 0;
  processed_emails = 0;
  server.search(['UNSEEN', ['SINCE', 'January 1, 2012']], function(err, results) {
    var fetch, options;
    if (err) {
      return die(err);
    }
    options = {
      markSeen: true,
      request: {
        body: 'full',
        headers: false
      }
    };
    if (!results.length) {
      setTimeout(function() {
        return get_new_emails(server);
      }, delay);
      return;
    }
    fetch = server.fetch(results, options);
    fetch.on('message', function(msg) {
      var parser;
      parser = new mailparser;
      parser.on('end', function(data) {
        data.id = msg.seqno;
        if (data.attachments.length) {
          return upload_photo(data);
        }
      });
      msg.on('data', function(data) {
        return parser.write(data.toString());
      });
      return msg.on('end', function() {
        console.log('Finished message:');
        return parser.end();
      });
    });
    return fetch.on('end', function() {});
  });
  tmp_dir = __dirname + "/../tmp/";
  return upload_photo = function(data) {
    var attachment, description, email, file_ext, file_path, name, uid, user;
    if (!data.attachments) {
      return;
    }
    user = null;
    uid = _.uniqueId();
    email = _.first(data.from).address;
    name = data.subject;
    description = data.text;
    attachment = _.find(data.attachments, function(x) {
      return !_.isUndefined(helpers.image.extensions[x.contentType]);
    });
    if (!attachment) {
      return;
    }
    file_ext = helpers.image.extensions[attachment.contentType];
    total_emails++;
    file_path = tmp_dir + uid + '__' + attachment.generatedFileName;
    return fs.writeFile(file_path, attachment.content, function() {
      var photo, queue;
      photo = new model.photo;
      queue = invoke(function(data, callback) {
        console.log("photo from email: find user by email - " + email);
        return model.user.findOne({
          email: email
        }, callback);
      }).then(function(data, callback) {
        user = data;
        photo.name = name;
        if (description && description !== '') {
          photo.description = description;
        }
        photo.ext = file_ext;
        photo.slug = 'from-mail-' + uid + '-' + nodejs_path.normalize(photo.name) + '-' + Math.random();
        photo._user = user._id;
        return photo.save(function(err) {
          console.log("photo from email: create - " + name);
          return callback(err);
        });
      }).then(function(data, callback) {
        console.log("photo from email: create tmp file - " + file_path);
        return photo.upload_photo(file_path, function(err) {
          if (err) {
            return callback(err);
          }
          return photo.resize_photos(function(err, dest) {
            processed_emails++;
            if (processed_emails === total_emails) {
              console.log("Done fetching all messages! Will retry in " + delay + "ms");
              setTimeout(function() {
                return get_new_emails(server);
              }, delay);
            }
            return callback(err, dest);
          });
        });
      });
      queue.and(function(data, callback) {
        return photo.set_slug(function(photo_slug) {
          console.log("photo from email: set slug - " + photo_slug);
          return callback(null, photo_slug);
        });
      });
      return queue.then(function(data, callback) {
        var logBuffer, proc, script;
        if (user.twitter && user.twitter.share) {
          script = fs.realpathSync(__dirname + '/twitter.js');
          proc = spawn('node', [script, photo._id]);
          logBuffer = function(buffer) {
            return console.log(buffer.toString());
          };
          proc.stdout.on('data', logBuffer);
          proc.stderr.on('data', logBuffer);
        }
        return callback();
      }).rescue(function(err) {
        console.log("photo from email: error");
        if (err) {
          return console.error(err);
        }
      }).end(null, function(data) {
        return console.log("photo from email: end - " + name);
      });
    });
  };
};
