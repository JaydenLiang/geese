/**
Configuration:
# create a dynamo db instance
## create a team table with name stored as lambda function environment variable TEAMS_TABLE
# store lambda function environment variables for slack app
## store CLIENT_ID and CLIENT_SECRET (find in your slack app in https://api.slack.com/apps/ > basic information)
# store INSTALL_SUCCESS_URL, INSTALL_ERROR_URL for installation handlers.
# modify api gateway
## check 'Use Lambda Proxy integration' for the GET method
# IAM role permissions:
## dynamodb:List, ReadItem, PutItem
*/

const qs = require('querystring');
const AWS = require('aws-sdk');
const fetch = require('node-fetch');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const getCode = (event) => {
  console.log(`call getCode with event`, event);
  var code = null;
  if (event.queryStringParameters && event.queryStringParameters.code) {
    code = event.queryStringParameters.code;
  }
  return code;
};

const requestToken = (code) => {
  console.log(`Requesting token with ${code}`);
  if (code === null) { return null; } // Skip if triggered without code
  const params = {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    code,
  };
  const url = `https://slack.com/api/oauth.access?${qs.stringify(params)}`;
  console.log(`Fetching ${url}`);
  return fetch(url)
    .then(response => response.json()) // Convert response to JSON
    .then((json) => {
      if (json.ok) return json; // Verify is valid JSON
      throw new Error('SlackAPIError');
    });
  };

  const saveResponse = (response) => {
    const params = {
      TableName: process.env.TEAMS_TABLE,
      Item: response,
    };
    console.log('Put', params);
    return dynamodb.put(params).promise();
  };

  const successResponse = callback => callback(null, {
    statusCode: 302,
    headers: { Location: process.env.INSTALL_SUCCESS_URL },
  });

  const errorResponse = (error, callback) => {
    console.error(error);
    return callback(null, {
      statusCode: 302,
      headers: { Location: process.env.INSTALL_ERROR_URL },
    });
  };

  module.exports.handler = (event, context, callback) =>
  Promise.resolve(event)
    .then(getCode) // Get code from event
    .then(requestToken) // Exchange code for token
    .then(saveResponse) // Save token to DDB
    .then(() => successResponse(callback))
    .catch(error => errorResponse(error, callback));

