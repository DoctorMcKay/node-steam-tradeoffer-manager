/**
 * STOREHOUSE - node-steam
 *
 * Uses node-steam-user for notifications and accepts all incoming trade offers,
 *    node-steamcommunity for confirming trades,
 *    node-steam-totp to generate 2FA codes
 */

var SteamUser = require('steam-user');
var SteamCommunity = require('steamcommunity');
var SteamTotp = require('steam-totp');
var TradeOfferManager = require('../lib/index.js'); // use require('steam-tradeoffer-manager') in production
var fs = require('fs');

var client = new SteamUser();
var manager = new TradeOfferManager({
	"steam": client, // Polling every 30 seconds is fine since we get notifications from Steam
	"domain": "example.com", // Our domain is example.com
	"language": "en" // We want English item descriptions
});
var community = new SteamCommunity();

// Steam logon options
var logOnOptions = {
	"accountName": "username",
	"password": "password",
	"twoFactorCode": SteamTotp.getAuthCode("sharedSecret")
};

if (fs.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(fs.readFileSync('polldata.json'));
}

client.logOn(logOnOptions);

client.on('loggedOn', function() {
	console.log("Logged into Steam");
});

client.on('webSession', function(sessionID, cookies) {
	manager.setCookies(cookies, function(err) {
		if (err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}

		console.log("Got API key: " + manager.apiKey);
	});

	community.setCookies(cookies);
	community.startConfirmationChecker(30000, "identitySecret"); // Checks and accepts confirmations every 30 seconds
});

manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID());
	offer.accept(function(err) {
		if (err) {
			console.log("Unable to accept offer: " + err.message);
		} else {
			community.checkConfirmations(); // Check for confirmations right after accepting the offer
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
	fs.writeFile('polldata.json', JSON.stringify(pollData));
});

/*
 * Example output:
 * 
 * Logged into Steam
 * Got API key: <key>
 * New offer #474127822 from [U:1:46143802]
 * Offer accepted
 * Offer #474127822 changed: Active -> Accepted
 * Received: Reinforced Robot Humor Suppression Pump, Reinforced Robot Humor Suppresion Pump
 */
