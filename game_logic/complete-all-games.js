var planAllGames = require('./plan-all-games.js');
var prepareUserContainers = require('../docker/prepare-user-containers.js');
var saveUserStats = require('../stats/save-user-stats.js')
var secrets = require('../secrets.js');
var Q = require('q');
var communicateWithContainers = require('../docker/container_interaction/communicate-with-containers.js');


var completeAllGames = function(users, mongoData) {

  var plannedGames = planAllGames(users);
  var games = plannedGames.games;
  var userLookup = plannedGames.userLookup;

  return prepRunAndSaveAllGames(mongoData, games, 0, userLookup);
}

//Runs and saves all games and returns a promise
var prepRunAndSaveAllGames = function(mongoData, games, gameIndex, userLookup) {
  console.log(games.length + ' games left to play!');
  var game = games.shift(games);

  //Run and save the first game in the queue
  return prepRunAndSaveGame(mongoData, game, gameIndex, userLookup).then(function() {

    //Loops recursively until games array is empty
    //Can't use Q.all because the games need to be run sequentially (b/c we can only
    //start up a finite # of docker containers at a time)
    if (games.length > 0) {
      return prepRunAndSaveAllGames(mongoData, games, gameIndex + 1, userLookup);
    }

  });
};

//Prepares the user containers for the upcoming game
//Then runs and saves that game to the database
var prepRunAndSaveGame = function(mongoData, game, gameIndex, userLookup) {
  return prepGame(game, userLookup).then(function() {
    return runAndSaveGame(mongoData, game, gameIndex, userLookup);
  }).then(function() {
    return updateMaxGameTurn(mongoData, game);
  });
};


//Start the user containers for each hero in the given game
var prepGame = function(game, userLookup) {
  var usersInGame = game.heroes.map(function(hero) {
    return userLookup[hero.name];
  });

  return prepareUserContainers(usersInGame);
};


var runAndSaveGame = function(mongoData, game, gameIndex, userLookup) {

  console.log('Running and saving game ' + gameIndex);

  //The collection we're inserting into
  var gameDataCollection = mongoData.gameDataCollection;

  //The database we're inserting into
  var mongoDb = mongoData.db;

  //Get date string for use in game ID (helpful saving uniquely to mongo db)
  var getDateString = function() {
    var dayOffset = secrets.dayOffset;
    var d = new Date((new Date()).getTime() + dayOffset*24*60*60*1000);
    var result = (d.getMonth() + 1).toString();
    result += '/' + d.getDate();
    result += '/' + d.getFullYear();
    return result;
  };

  //Loops through the entire game, saves each turn to the database
  var resolveGameAndSaveTurnsToDB = function(game) {
    //Get today's date in string form
    game.date = getDateString();

    //Manually set the ID so Mongo doesn't just keep writing to the same document
    game.baseId = gameIndex.toString() + '|' + game.date;
    game._id = game.baseId + '|' + game.turn.toString();

    //Save the number of the game
    game.gameNumber = gameIndex;

    //Save the game to the database
    return Q.npost(gameDataCollection, 'update', [
      {
        '_id':game._id
      }, game, {
        upsert:true
      }

    //Then get the next direction the activeHero wants to move
    ]).then(function(result) {

      //Get the current hero
      var activeHero = game.activeHero;


      //Get the direction the currently active hero wants to move
      var port = userLookup[activeHero.name].port;
      
      console.log('Turn: ' + game.turn + ', Port: ' + port + ', User: ' + activeHero.name);

      return communicateWithContainers.postGameData(port, game)
      

    //Then move the active hero in that direction
    }).then(function(direction) {

      console.log('Direction is: ' + direction);

      //If game has ended, stop looping and set the max turn
      if (game.ended) {
        return game;

      //Otherwise, continue with next turn and save that turn
      } else {
        //Advances the game one turn
        game.handleHeroTurn(direction);

        return resolveGameAndSaveTurnsToDB(game);
      }
    }).catch(function(err) {
      console.trace();
      console.log('---------')
      console.log(err);
      throw err;
    });
  };

  //Runs the game and saves the result to DB
  return resolveGameAndSaveTurnsToDB(game);
}

var updateMaxGameTurn = function(mongoData, game) {
  //Updates the game turn objects to have the correct maxTurn
  //This is necessary for the front end to know the total # of turns
  console.log('Updating maxTurn for each turn...');
  console.log(game.maxTurn);

  var gameDataCollection = mongoData.gameDataCollection;

  return Q.npost(gameDataCollection, 'update', [
    {
      date: game.date,
      gameNumber: game.gameNumber
    },
    {
      $set: {
        maxTurn: game.maxTurn
      }
    },
    {
      multi: true
    }
  ]).then(function() {
    console.log('Game turns updated!');
    console.log('Updating all user stats...');
    return Q.all(game.heroes.map(function(hero) {
      return saveUserStats(mongoData, hero, game.baseId);
    }));
  });
};


module.exports = completeAllGames;