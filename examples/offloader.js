/**
 * OFFLOADER
 *
 * Once logged in, sends a trade offer containing this account's entire tradable CS:GO inventory.
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

		// Get our inventory
		manager.loadInventory(730, 2, true, function(err, inventory) {
			if (err) {
				console.log(err);
				return;
			}

			if (inventory.length == 0) {
				// Inventory empty
				console.log("CS:GO inventory is empty");
				return;
			}

			console.log("Found " + inventory.length + " CS:GO items");

			// Create and send the offer
			var offer = manager.createOffer("https://steamcommunity.com/tradeoffer/new/?partner=12345678&token=xxxxxxxx");
			offer.addMyItems(inventory);
			offer.setMessage("Here, have some items!");
			offer.send(function(err, status) {
				if (err) {
					console.log(err);
					return;
				}

				if (status == 'pending') {
					// We need to confirm it
					console.log(`Offer #${offer.id} sent, but requires confirmation`);
					community.acceptConfirmationForObject("identitySecret", offer.id, function(err) {
						if (err) {
							console.log(err);
						} else {
							console.log("Offer confirmed");
						}
					});
				} else {
					console.log(`Offer #${offer.id} sent successfully`);
				}
			});
		});
	});

	community.setCookies(cookies);
});

manager.on('sentOfferChanged', function(offer, oldState) {
	console.log(`Offer #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
});

manager.on('pollData', function(pollData) {
	fs.writeFile('polldata.json', JSON.stringify(pollData));
});

/*
 * Example output:
 *
 * Logged into Steam
 * Got API key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * Found 117 CS:GO items
 * Offer #1601569319 sent, but requires confirmation
 * Offer confirmed
 */
