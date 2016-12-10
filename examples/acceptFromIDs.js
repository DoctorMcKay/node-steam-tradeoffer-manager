const SteamUser = require('steam-user'),
SteamTotp = require('steam-totp'),
TradeOfferManager = require('steam-tradeoffer-manager'),
SteamCommunity = require('steamcommunity');

var client = new SteamUser(),
community = new SteamCommunity(),
manager = new TradeOfferManager({
	"steam": client,
	"domain": "nothinghere",
	"language": "en"
});

var config = {
	"username": "",
	"password": "",
	"identitySecret": "",
	"sharedSecret": "",
	"acceptSteamIDS": [
		"SteamID",
		"SteamID",
		"SteamID"
  	]
};


function logOn() {
	client.logOn({
		"accountName": config.username,
		"password": config.password,
		"twoFactorCode": SteamTotp.generateAuthCode(config.sharedSecret)
	});
}
logOn();
client.on('webSession', function(sessionID, cookies) {
	manager.setCookies(cookies, function(err) {
		if (err) {
			console.log(err);
			process.exit(1);
			return;
		}
	});
});

client.on('loggedOn', function(details) {
	console.log("Logged into Steam as " + client.steamID.getSteam3RenderedID());
	client.setPersona(SteamUser.EPersonaState.Online);
});



client.on('webSession', function(sessionID, cookies) {
	manager.setCookies(cookies, function(err) {
		if (err) {
			console.log(err);
			process.exit(1);
			return;
		}

		console.log("Got API key: " + manager.apiKey);
	});

	community.setCookies(cookies);
	community.startConfirmationChecker(30000, config.identitySecret);
});
manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteamID64());
	if (config.acceptSteamIDS.indexOf(offer.partner.getSteamID64()) >= 0) {
		offer.accept(function(err) {
			if (err) {
				console.log("Unable to accept offer: " + err.message);
			} else if (exists(offer.partner.getSteamID64()) == true) {
				console.log("Offer Accepted from "+offer.partner.getSteamID64());
			}
		});
	}
});
