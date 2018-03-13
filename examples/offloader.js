/**
 * OFFLOADER
 *
 * Once logged in, sends a trade offer containing this account's entire tradable CS:GO inventory.
 */

const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const SteamTotp = require('steam-totp');
const TradeOfferManager = require('../lib/index.js'); // use require('steam-tradeoffer-manager') in production
const fs = require('fs');

const client = new SteamUser();
const manager = new TradeOfferManager({
	steam: client, // Polling every 30 seconds is fine since we get notifications from Steam
	domain: 'example.com', // Our domain is example.com
	language: 'en' // We want English item descriptions
});
const community = new SteamCommunity();

// Steam logon options
const logOnOptions = {
	accountName: 'username',
	password: 'password',
	twoFactorCode: SteamTotp.getAuthCode('sharedSecret')
};

if (fs.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(fs.readFileSync('polldata.json').toString('utf8'));
}

client.logOn(logOnOptions);

client.on('loggedOn', () => {
	console.log('Logged into Steam');
});

client.on('webSession', (sessionID, cookies) => {
	manager.setCookies(cookies, (err) => {
		if (err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}

		console.log(`Got API key: ${manager.apiKey}`);

		// Get our inventory
		manager.getInventoryContents(730, 2, true, (err, inventory) => {
			if (err) {
				console.log(err);
				return;
			}

			if (inventory.length === 0) {
				// Inventory empty
				console.log('CS:GO inventory is empty');
				return;
			}

			console.log(`Found ${inventory.length} CS:GO items`);

			// Create and send the offer
			const offer = manager.createOffer('https://steamcommunity.com/tradeoffer/new/?partner=12345678&token=xxxxxxxx');
			offer.addMyItems(inventory);
			offer.setMessage('Here, have some items!');
			offer.send((err, status) => {
				if (err) {
					console.log(err);
					return;
				}

				if (status === 'pending') {
					// We need to confirm it
					console.log(`Offer #${offer.id} sent, but requires confirmation`);
					community.acceptConfirmationForObject('identitySecret', offer.id, (err) => {
						err ? err : console.log('Offer confirmed');
					});
				} else {
					console.log(`Offer #${offer.id} sent successfully`);
				}
			});
		});
	});

	community.setCookies(cookies);
});

manager.on('sentOfferChanged', (offer, oldState) => {
	console.log(`Offer #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
});

manager.on('pollData', (pollData) => {
	fs.writeFileSync('polldata.json', JSON.stringify(pollData));
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
