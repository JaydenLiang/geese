/* eslint-disable no-console */
const AWS = require('aws-sdk'); // eslint-disable-line

const lambda = new AWS.Lambda();
const dynamodb = new AWS.DynamoDB.DocumentClient();

// Get JUST the Slack event.
const getSlackEvent = event => ({ slack: JSON.parse(event.body) });

// Keep Slack happy by reponding to the event.
const respond = callback => (event) => {
  const response = { statusCode: 200 };
  if (event.slack.type === 'url_verification') {
    response.body = event.slack.challenge;
  }
  callback(null, response);
  return event;
};

// Verify the token matches ours.
const verifyToken = (event) => {
  if (event.slack.token !== process.env.VERIFICATION_TOKEN) {
    throw new Error('InvalidToken');
  }
  return event;
};

// Get the team details form DDB.
const getTeam = (event) => {
  const params = {
    TableName: process.env.TEAMS_TABLE,
    Key: {
      team_id: event.slack.team_id,
    },
  };
  console.log('dynamodb.get', params);
  return dynamodb.get(params).promise()
    .then(data => Object.assign(event, { team: data.Item }));
};

/**
* Check for direct message.
* See: https://stackoverflow.com/questions/41111227/how-can-a-slack-bot-detect-a-direct-message-vs-a-message-in-a-channel
*/
const checkForDirectMessage = (event) => {
  const messageType = event.slack.event.channel.substring(0, 1);
  const botUserId = event.team.bot.bot_user_id;
  const message = event.slack.event.text;
  const messageReceivers = event.slack.event.authed_users;
  if (messageReceivers.indexOf(botUserId) >= 0 && messageType == 'D') {
    console.log(`Bot ${botUserId} received a direct message: "${message}"`);
    return event;
  }
  else return null;
};

// Check for mention.
const checkForMention = (event) => {
  const message = event.slack.event.text;
  const botUserId = event.team.bot.bot_user_id;
  const botUserIsMentioned = new RegExp(`^.*<@${botUserId}>.*$`);
  if (botUserIsMentioned.test(message)) {
    console.log(`Bot ${botUserId} is mentioned in "${message}"`);
    return event;
  }
  else return null;
};

// Invoke action endpoint, if valid request.
const actionFunctionName = `${process.env.NAMESPACE}-actions`;
const invokeAction = (event) => {
  if (!event) return null;
  console.log(`Invoking ${actionFunctionName} with event`, event);
  return lambda.invoke({
    FunctionName: actionFunctionName,
    InvocationType: 'Event',
    LogType: 'None',
    Payload: JSON.stringify(event),
  }).promise();
};

// Check if an action is needed to take
const checkForActions = (event) => {
  console.log(`Check for action on event: `, event);
  if(checkForMention(event) === event
    || checkForDirectMessage(event) === event
  ){
    return invokeAction(event);
  }
};

module.exports.handler = (event, context, callback) =>
  Promise.resolve(event) // Start the promise chain
    .then(getSlackEvent) // Get just the Slack event payload
    .then(respond(callback)) // Respond OK to Slack
    .then(verifyToken) // Verify the token
    .then(getTeam) // Get the team data from DDB
    .then(checkForActions) // Check if an action is needed to take, then invoke the action
    .catch(callback);

