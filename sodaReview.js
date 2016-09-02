'use strict';

require('babel-register')({
  presets: ['es2015', 'react'],
});

const Hapi = require('hapi');
const Joi = require('joi');
//const _ = require('underscore');
const async = require('async');
//const fs = require('fs');
//const https = require('https');
const moment = require('moment');
const mongoclient = require('mongodb').MongoClient;
const os = require('os');
//const uuid = require('node-uuid');

const server = new Hapi.Server();
server.connection({
  address: '0.0.0.0',
  port: 8080,
});

let mongodbUri = 'mongodb://localhost:27017/local';
let db = '';

mongoclient.connect(mongodbUri, function(err, database) {
  if (err) {
    server.log(['debug'], 'MongoDB Connection error: ' + err);
  }
  db = database;
  server.log(['debug'], 'Connected to: ' + mongodbUri);
});

server.register([{
  register: require('good'),
  options: {
    ops: {
      interval: 600000
    },
    reporters: {
      console: [{
        module: 'good-squeeze',
        name: 'Squeeze',
        args: [{
          log: '*',
          response: '*',
          request: '*',
          error: '*',
          ops: '*'
        }]
      }, {
        module: 'good-console',
        args: [{
          format: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
          utc: true,
          color: true
        }]
      }, 'stdout']
    }
  }
}, {
  register: require('inert')
}, {
  register: require('vision')
}, {
  register: require('hapi-swagger'),
  options: {
    host: server.info.uri,
    basePath: '/',
    schemes: ['http'],
    jsonEditor: true,
    info: {
      title: 'sodaReview API Documentation',
      version: '0.0.1',
    },
    tags: [],
    sortEndpoints: 'path'
  }
}], function(err) {
  if (err) {
    server.error(err);
  } else {
    server.views({
      engines: {
        jsx: require('hapi-react-views')
      },
      relativeTo: __dirname,
      path: 'public/views'
    });
    server.route([{
      method: 'GET',
      path: '/{param*}',
      config: {
        tags: ['endPoint'],
        auth: false
      },
      handler: {
        directory: {
          path: '/public/',
          index: ['index.html']
        }
      }
    }, {
      method: 'GET',
      path: '/',
      handler: {
        view: 'Default'
      }
    }, {
      method: 'GET',
      path: '/validate/up/{source}',
      config: {
        description: 'Validates working server (for monitoring).',
        notes: 'Public API (no authorization required)',
        tags: ['api'],
        validate: {
          params: {
            source: Joi.string().required().description('This will be returned under the source key of the response object')
          }
        },
        auth: false
      },
      handler: function(req, res) {
        let responseObj = {
          timestamp: moment().toISOString(),
          service: 'sodaReview',
          server: os.hostname(),
          source: req.params.source
        };
        res(JSON.stringify(responseObj)).type('application/json');
      }
    }, {
      method: 'PUT',
      path: '/api/v0/post/review',
      config: {
        description: 'Used to post a new soda review',
        notes: 'Public API (no authorization required)',
        tags: ['api'],
        validate: {
          payload: {
            userEmail: Joi.string().email().required().description('Email address of user posting review'),
            dateVisited: Joi.date().iso().required().description('Date of the soda visitation'),
            overallRating: Joi.number().min(0).max(10).required().description('Rating for the overall experience on a scale of 0-10'),
            restaurant: Joi.object().required().keys({
              name: Joi.string().required().description('Name of Restaurant'),
              location: Joi.string().required().description('Address of Restaurant (Could be GPS coordinates or some Google Places id instead)'),
              rating: Joi.number().min(0).max(10).required().description('Rating for the restaurant experience on a scale of 0-10'),
              comments: Joi.string().optional().allow('').description('Any user submitted comments about the restaurant')
            }).description('Restaurant details for review/search & aggregation/correlation'),
            drinks: Joi.array().required().items(Joi.object().required().keys({
              name: Joi.string().required().description('Name of Soda Beverage'),
              rating: Joi.number().min(0).max(10).required().description('Rating for the soda experience on a scale of 0-10'),
              comments: Joi.string().optional().allow('').description('Any user submitted comments about the drink')
            }).description('Drink details for review/search & aggregation/correlation')).description('Array of drink objects consumed/tested by the user'),
            dispensor: Joi.object().required().keys({
              attributes: Joi.array().required().items(Joi.string().required().description('Description of dispensor attributes (such as "Touch Screen", "Single Dispensor", "Multiple Options", etc)')),
              expRating: Joi.number().min(0).max(10).required().description('Rating for the dispensor experience on a scale of 0-10'),
              cleanRating: Joi.number().min(0).max(10).required().description('Rating for the dispensor cleanliness on a scale of 0-10'),
              comments: Joi.string().optional().allow('').description('Any user submitted comments about the dispensor')
            }).description('Drink dispensor details for review/search & aggregation/correlation')
          }
        },
        auth: false
      },
      handler: function(req, res) {
        let response = {};
        let reviewDetails = {
          dateCreated: new Date().toISOString(),
          userEmail: req.payload.userEmail,
          dateVisited: req.payload.dateVisited,
          overallRating: req.payload.overallRating,
          restaurant: req.payload.restaurant,
          drinks: [],
          dispensor: req.payload.dispensor
        };
        async.series({
          addDrinkReviews: function(callback) {
            let i = 0;
            (function addDrinks() {
              reviewDetails.drinks[i] = req.payload.drinks[i];
              if (i == req.payload.drinks.length - 1) {
                callback();
              } else {
                i += 1;
                addDrinks();
              }
            }());
          },
        }, function(err, results) {
          if (err) {
            response = {
              'api': req.path,
              'result': 'Failure',
              'errorString': 'Error occurring when adding drinks to reviewDetails object: ' + err
            };
            res(JSON.stringify(response)).type('application/json');
          } else {
            req.log(['debug'], 'addDrinkReviews results: ' + JSON.stringify(results));
            req.log(['debug'], 'reviewDetails: ' + JSON.stringify(reviewDetails));
            db.collection('sodaReviews').insert(reviewDetails, function(err, results) {
              if (err) {
                response.result = 'Failure';
                response.details = results;
                res(JSON.stringify(response)).type('application/json');
              } else {
                response.result = 'Success';
                response.details = results;
                res(JSON.stringify(response)).type('application/json');
              }
            });
          }
        });
      }
    }, {
      method: 'GET',
      path: '/api/v0/retrieve/{searchType}/{searchString}',
      config: {
        description: 'Retrieve all reviews about a restaurant or soda or from a user',
        notes: 'Public API (no authorization required). Future enhancements would allow for location range parameter post Google Places integration',
        tags: ['api'],
        validate: {
          params: {
            searchType: Joi.string().valid('restaurant', 'drink', 'user').required().description('Type of review retrieval: restaurant, drink, or user'),
            searchString: Joi.string().required().description('Name of restaurant, drink, or user to retrieve reviews')
          }
        },
        auth: false
      },
      handler: function(req, res) {
        let responseList = [];
        switch (req.params.searchType) {
          case 'restaurant':
            db.collection('sodaReviews').find({
              'restaurant.name': req.params.searchString
            }).each(function(err, documents) {
              if (err) {
                req.log(['debug'], 'review search error: ' + err);
                res(JSON.stringify({
                  'api': req.path,
                  'result': 'Failure',
                  'errorString': 'Error occurred retrieving matches: ' + err
                })).type('application/json');
              }
              req.log(['debug'], 'review search matches: ' + JSON.stringify(documents));
              if (documents !== null) {
                responseList.push(documents);
              } else {
                res(JSON.stringify(responseList)).type('application/json');
              }
            });
            break;
          case 'drink':
            db.collection('sodaReviews').aggregate({
              $match: {}
            }, {
              $unwind: '$drinks'
            }, {
              $match: {
                'drinks.name': req.params.searchString
              }
            }, {
              $project: {
                'drinks': 1
              }
            }).each(function(err, documents) {
              if (err) {
                req.log(['debug'], 'review search error: ' + err);
                res(JSON.stringify({
                  'api': req.path,
                  'result': 'Failure',
                  'errorString': 'Error occurred retrieving matches: ' + err
                })).type('application/json');
              }
              req.log(['debug'], 'review search matches: ' + JSON.stringify(documents));
              if (documents !== null) {
                responseList.push(documents);
              } else {
                res(JSON.stringify(responseList)).type('application/json');
              }
            });
            break;
          case 'user':
            db.collection('sodaReviews').find({
              'userEmail': req.params.searchString
            }).each(function(err, documents) {
              if (err) {
                req.log(['debug'], 'review search error: ' + err);
                res(JSON.stringify({
                  'api': req.path,
                  'result': 'Failure',
                  'errorString': 'Error occurred retrieving matches: ' + err
                })).type('application/json');
              }
              req.log(['debug'], 'review search matches: ' + JSON.stringify(documents));
              if (documents !== null) {
                responseList.push(documents);
              } else {
                res(JSON.stringify(responseList)).type('application/json');
              }
            });
            break;
          default:
            res(JSON.stringify({
              'api': req.path,
              'result': 'Failure',
              'errorString': 'Invalid search type presented.'
            })).type('application/json');
        }
      }
    }]);

    server.start(function() {
      server.log(['info', 'env'], 'Soda Review started and listening at ' + server.info.uri);
    });
  }
});
