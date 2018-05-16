/**
Configuration:
# store lambda function environment variables for slack app
## store APP_VERIFICATION_TOKEN for slack app verification token (find in your slack app in https://api.slack.com/apps/ > basic information)
## store LAMBDA_APP_NAMESPACE for a serial of functions for krouze-geese-emonalysis
## store TEAMS_TABLE for the team table name in DynamoDB
# IAM role permissions:
## dynamodb:List, ReadItem (required)
## lambda: invocation
*/
/* eslint-disable no-console */
const AWS = require('aws-sdk'); // eslint-disable-line

const lambda = new AWS.Lambda();
const dynamodb = new AWS.DynamoDB.DocumentClient();

// Get JUST the Slack event.
const getSlackEvent = (event) => {
    console.log("call getSlackEvent()", event);
    //TODO test condition, remove from production
    if(event.mock_test){
        return {slack: event.slack};
    }
    else if(event.slack){
        return { slack: event.slack };
    }
    else{
        return { slack: event};
    }
};

const isUrlVerification = (event, callback) => {
    console.log(`call isUrlVerification`);
    if (event.slack.type === 'url_verification') {
        callback(null, { statusCode: 200, body: event.slack.challenge});
        return Promise.reject();
    }
    else{
        return event;
    }
};

//acknowledge an event from subscription.
const acknowledgeEvent = (event, callback) => {
    console.log(`call acknowledgeEvent`);
    callback(null, { statusCode: 200, body: ''});
    return event;
};

//do some authentication for the slack app
const slackAppAuthentication = (event) => {
    console.log(`call slackAppAuthentication`, event);
    if (event.slack.token !== process.env.APP_VERIFICATION_TOKEN) {
        throw new Error('Invalid App Token');
    }
    else{
        return event;
    }
};

const filterBotEvents = (event) => {
    console.log(`call filterBotEvents`);
    if(event.slack.event.type == 'message' && event.slack.event.subtype == 'bot_message'){
        return Promise.reject();
    }
    else{
        return Promise.resolve(event);
    }
};

// Get the team details form DDB.
const getTeamApp = (event) => {
    console.log(`call getTeamApp for team_id:`,event.slack.team_id);
    const params = {
        TableName: process.env.TEAMS_TABLE,
        Key: {
          team_id: event.slack.team_id,
      },
  };

  return dynamodb.get(params).promise()
  .then(data => Object.assign(event, { team_app: data.Item }));
};

const isDirectMessage = (event) => {
    //by definition in Slack documentation, channel id starting with D is a direct message
    console.log('isDirectMessage', event.slack.event.channel.substring(0, 1) == 'D');
    return event.slack.event.channel.substring(0, 1) == 'D';
};

const directMessageToInclude = (event, id) =>{
    console.log("directMessageToInclude", event.slack.authed_users.indexOf(id) >= 0);
    return event.slack.authed_users.indexOf(id) >= 0;
}

/**
* Check for direct message.
* See: https://stackoverflow.com/questions/41111227/how-can-a-slack-bot-detect-a-direct-message-vs-a-message-in-a-channel
*/
const checkForDirectMessage = (event) => {
    const botUserId = event.team_app.bot.bot_user_id;
    const message = event.slack.event.text;
    console.log(`call checkForDirectMessage()`, botUserId, message);
    if (directMessageToInclude(event, botUserId) && isDirectMessage(event)) {
        console.log(`Bot ${botUserId} received a direct message: "${message}"`);
        return true;
    }
    else return false;
};

const isMentionedInMessage = (message, id) => {
    console.log("call isMentionedInMessage()");
    return (new RegExp(`^.*<@${id}>.*$`)).test(message);
};

// Check for mention.
const checkForMention = (event) => {
  const message = event.slack.event.text;
  const botUserId = event.team_app.bot.bot_user_id;
  console.log("call checkForMention()");
  if (isMentionedInMessage(message, botUserId)) {
    console.log(`Bot ${botUserId} is mentioned in "${message}"`);
    return true;
}
else return false;
};

// Invoke action endpoint, if valid request.
const invokeActions = (event) => {
    console.log("call invokeAction()");
    if (!event) return null;
    const actionFunctionName = `${process.env.LAMBDA_APP_NAMESPACE}-actions`;
    console.log(`Invoking ${actionFunctionName} with event`);
    return lambda.invoke({
        FunctionName: actionFunctionName,
        InvocationType: 'Event',
        LogType: 'None',
        Payload: JSON.stringify(event),
    }).promise();
};

// Check if an action is needed to take
const checkForActions = (event) => {
    console.log(`call checkForActions()`, event);
    if(checkForMention(event) || checkForDirectMessage(event)){
        return invokeActions(event);
    }
    else{
        return null;
    }
};

const errorHandler = (err, callback) => {
    var message = '';
    if(err){
        console.log(`error occur: ${err.message}`);
        message = err.message;
    }
    callback(null, { statusCode: 200, body: message });
};

module.exports.handler = (event, context, callback) => 
  Promise.resolve(event) // Start the promise chain
    .then(getSlackEvent) // Get just the Slack event payload
    .then(slackAppAuthentication) // verify that requests are actually coming from this Slack app
    .then((event) => isUrlVerification(event, callback))
    .then(filterBotEvents) // filter and ignore some bot events
    .then((event) => acknowledgeEvent(event, callback)) // acknowledge a valid event from the team
    .then(getTeamApp) // Get the installed team app data from DynamoDB
    .then(checkForActions) // Check if an action is needed to take, then invoke the action
    .catch((err) => errorHandler(err, callback));
