/**
 * STOREHOUSE - node-steamcommunity
 *
 * Uses node-steamcommunity to login to Steam and accepts all incoming trade offers
 */

var SteamCommunity = require('steamcommunity');
var TradeOfferManager = require('../lib/index.js'); // use require('steam-tradeoffer-manager') in production
var fs = require('fs');

var steam = new SteamCommunity();
var manager = new TradeOfferManager({
	"domain": "example.com", // Our domain is example.com
	"language": "en", // We want English item descriptions
	"pollInterval": 5000 // We want to poll every 5 seconds since we don't have Steam notifying us of offers
});

// Steam logon options
var logOnOptions = {
	"accountName": "username",
	"password": "password"
};

var authCode = ''; // Steam Guard email auth code

if(fs.existsSync('steamguard.txt')) {
	logOnOptions.steamguard = fs.readFileSync('steamguard.txt').toString('utf8');
} else if(authCode) {
	logOnOptions.authCode = authCode;
}

if(fs.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(fs.readFileSync('polldata.json'));
}

steam.login(logOnOptions, function(err, sessionID, cookies, steamguard) {
	if(err) {
		console.log("Steam login fail: " + err.message);
		process.exit(1);
	}

	fs.writeFile('steamguard.txt', steamguard);
	
	console.log("Logged into Steam");
	
	manager.setCookies(cookies, function(err) {
		if(err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}
		
		console.log("Got API key: " + manager.apiKey);
	});
});

manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID());
	offer.accept(function(err) {
		if(err) {
			console.log("Unable to accept offer: " + err.message);
		} else {
			console.log("Offer accepted");
		}
	});
});

manager.on('receivedOfferChanged', function(offer, oldState) {
	console.log("Offer #" + offer.id + " changed: " + TradeOfferManager.getStateName(oldState) + " -> " + TradeOfferManager.getStateName(offer.state));
	
	if(offer.state == TradeOfferManager.ETradeOfferState.Accepted) {
		offer.getReceivedItems(function(err, items) {
			if(err) {
				console.log("Couldn't get received items: " + err);
			} else {
				var names = items.map(function(item) {
					return item.name;
				});
				
				console.log("Received: " + names.join(', '));
			}
		});
	}
});

manager.on('pollData', function(pollData) {
	fs.writeFile('polldata.json', JSON.stringify(pollData));
});

/*
 * Example output:
 * 
 * Logged into Steam
 * Got API key: <key>
 * New offer #474139989 from [U:1:46143802]
 * Offer accepted
 * Offer #474139989 changed: Active -> Accepted
 * Received: Reinforced Robot Bomb Stabilizer
 */
