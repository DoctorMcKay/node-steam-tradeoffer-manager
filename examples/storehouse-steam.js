/**
 * STOREHOUSE - node-steam
 *
 * Uses node-steam-user for notifications and accepts all incoming trade offers,
 *    node-steamcommunity for confirming trades,
 *    node-steam-totp to generate 2FA codes
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
	});

	community.setCookies(cookies);
});

manager.on('newOffer', function (offer) {
	console.log(`New offer #${offer.id} from ${offer.partner.getSteam3RenderedID()}`);
	offer.accept((err, status) => {
		if (err) {
			console.log(`Unable to accept offer: ${err.message}`);
		} else {
			console.log(`Offer accepted: ${status}`);
			if (status === 'pending') {
				community.acceptConfirmationForObject('identitySecret', offer.id, (err) => {
					if (err) {
						console.log(`Can't confirm trade offer: ${err.message}`);
					} else {
						console.log(`Trade offer ${offer.id} confirmed`);
					}
				});
			}
		}
	});
});

manager.on('receivedOfferChanged', (offer, oldState) => {
	console.log(`Offer #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);

	if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
		offer.getExchangeDetails((err, status, tradeInitTime, receivedItems, sentItems) => {
			if (err) {
				console.log(`Error ${err}`);
				return;
			}

			// Create arrays of just the new assetids using Array.prototype.map and arrow functions
			const newReceivedItems = receivedItems.map(item => item.new_assetid);
			const newSentItems = sentItems.map(item => item.new_assetid);

			console.log(`Received items ${newReceivedItems.join(',')} Sent Items ${newSentItems.join(',')} - status ${TradeOfferManager.ETradeStatus[status]}`)
		})
	}
});

manager.on('pollData', (pollData) => {
	fs.writeFileSync('polldata.json', JSON.stringify(pollData));
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
