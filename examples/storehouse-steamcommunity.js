/**
 * STOREHOUSE - node-steamcommunity
 *
 * Uses node-steamcommunity to login to Steam, accept and confirm all incoming trade offers,
 *    node-steam-totp to generate 2FA codes
 */

const SteamCommunity = require('steamcommunity');
const SteamTotp = require('steam-totp');
const TradeOfferManager = require('../lib/index.js'); // use require('steam-tradeoffer-manager') in production
const FS = require('fs');

let community = new SteamCommunity();
let manager = new TradeOfferManager({
	"domain": "example.com", // Our domain is example.com
	"language": "en", // We want English item descriptions
	"pollInterval": 5000 // We want to poll every 5 seconds since we don't have Steam notifying us of offers
});

// Steam logon options
let logOnOptions = {
	"accountName": "username",
	"password": "password",
	"twoFactorCode": SteamTotp.getAuthCode("sharedSecret")
};

if (FS.existsSync('steamguard.txt')) {
	logOnOptions.steamguard = FS.readFileSync('steamguard.txt').toString('utf8');
}

if (FS.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(FS.readFileSync('polldata.json').toString('utf8'));
}

community.login(logOnOptions, function(err, sessionID, cookies, steamguard) {
	if (err) {
		console.log("Steam login fail: " + err.message);
		process.exit(1);
	}

	FS.writeFileSync('steamguard.txt', steamguard);

	console.log("Logged into Steam");

	manager.setCookies(cookies, function(err) {
		if (err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}

		console.log("Got API key: " + manager.apiKey);
	});
});

manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID());
	offer.accept(function(err, status) {
		if (err) {
			console.log("Unable to accept offer: " + err.message);
		} else {
			console.log("Offer accepted: " + status);
			if (status == "pending") {
				community.acceptConfirmationForObject("identitySecret", offer.id, function(err) {
					if (err) {
						console.log("Can't confirm trade offer: " + err.message);
					} else {
						console.log("Trade offer " + offer.id + " confirmed");
					}
				});
			}
		}
	});
});

manager.on('receivedOfferChanged', function(offer, oldState) {
	console.log(`Offer #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);

	if (offer.state == TradeOfferManager.ETradeOfferState.Accepted) {
		offer.getExchangeDetails((err, status, tradeInitTime, receivedItems, sentItems) => {
			if (err) {
				console.log(`Error ${err}`);
				return;
			}

			// Create arrays of just the new assetids using Array.prototype.map and arrow functions
			let newReceivedItems = receivedItems.map(item => item.new_assetid);
			let newSentItems = sentItems.map(item => item.new_assetid);

			console.log(`Received items ${newReceivedItems.join(',')} Sent Items ${newSentItems.join(',')} - status ${TradeOfferManager.ETradeStatus[status]}`)
		})
	}
});

manager.on('pollData', function(pollData) {
	FS.writeFileSync('polldata.json', JSON.stringify(pollData));
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
