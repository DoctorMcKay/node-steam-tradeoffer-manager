/**
 * STOREHOUSE - node-steamcommunity
 *
 * Uses node-steamcommunity to login to Steam, accept and confirm all incoming trade offers,
 *    node-steam-totp to generate 2FA codes
 */

var SteamCommunity = require('steamcommunity');
var SteamTotp = require('steam-totp');
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
	"password": "password",
	"twoFactorCode": SteamTotp.getAuthCode("sharedSecret")
};

if (fs.existsSync('steamguard.txt')) {
	logOnOptions.steamguard = fs.readFileSync('steamguard.txt').toString('utf8');
}

if (fs.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(fs.readFileSync('polldata.json'));
}

steam.login(logOnOptions, function(err, sessionID, cookies, steamguard) {
	if (err) {
		console.log("Steam login fail: " + err.message);
		process.exit(1);
	}

	fs.writeFile('steamguard.txt', steamguard);

	console.log("Logged into Steam");

	manager.setCookies(cookies, function(err) {
		if (err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}

		console.log("Got API key: " + manager.apiKey);
	});

	steam.startConfirmationChecker(30000, "identitySecret"); // Checks and accepts confirmations every 30 seconds
});

manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID());
	offer.accept(function(err) {
		if (err) {
			console.log("Unable to accept offer: " + err.message);
		} else {
			steam.checkConfirmations(); // Check for confirmations right after accepting the offer
			console.log("Offer accepted");
		}
	});
});

manager.on('receivedOfferChanged', function(offer, oldState) {
	console.log(`Offer #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);

	if (offer.state == TradeOfferManager.ETradeOfferState.Accepted) {
		offer.getReceivedItems(function(err, items) {
			if (err) {
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
	fs.writeFile('polldata.json', JSON.stringify(pollData), function() {});
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
