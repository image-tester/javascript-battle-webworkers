var MongoClient = require('mongodb').MongoClient;
var Q = require('q');
var Game = require('./Game.js');
var move = require('./hero.js');

// var mongoConnectionURL = process.env.CUSTOMCONNSTR_MONGO_URI;// || 'mongodb://localhost/javascriptBattle'
// var mongoConnectionURL = 'mongodb://localhost/javascriptBattle';

var openGameDatabase = function() {
  return Q.ninvoke(MongoClient, 'connect', mongoConnectionURL).then(function(db) {
    console.log('open!');
    return db.collection('jsBattleGameData');
  })
};

var addGameDataToDatabase = function(collection, gameData, date) {
  gameData.date = date;
  return Q.ninvoke(collection, 'insert', gameData).then(function(docs) {
    console.log('~~~~~~');
    console.log(docs);
    console.log('~~~~~~');
  }, function(err) {
    console.log(err);
  });
};

var getDateString = function() {
  var d = new Date();
  var result = (d.getMonth() + 1).toString();
  result += '/' + d.getDate();
  result += '/' + d.getFullYear();
  return result;
};

var runGame = function() {
  var game = new Game();
  game.addHero(0,0);
  game.addHero(0,4);
  game.addHero(4,0);
  game.addHero(4,4);

  game.addHealthWell(2,2);
  
  game.addImpassable(2,1);
  game.addImpassable(2,3);

  game.addDiamondMine(0,2);
  game.addDiamondMine(2,0);
  game.addDiamondMine(4,2);
  game.addDiamondMine(2,4);


  var date = getDateString();
  var openDatabasePromise = openGameDatabase();
  game._id = game.turn + '|' + date;


  //Open mongo connection
  openDatabasePromise.then(function(collection) {
    //Store 1st turn
    var addGameDataPromise = addGameDataToDatabase(collection, game, date);

    //Store all remaining turns
    for (var i=0; i<400; i++) {
      addGameDataPromise = addGameDataPromise.then(function() {
        console.log('Added turn: ' + game.turn);
        
        game.handleHeroTurn(move(game));
        game._id = game.turn + '|' + date;

        return addGameDataToDatabase(collection, game, date);
      });
    }
  }).catch(function(err) {
    console.log(err);
  });
};

runGame();