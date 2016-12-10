var SteamUser = require('steam-user');
var client = new SteamUser();
var TradeOfferManager = require('steam-tradeoffer-manager');
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
var SteamTotp = require('steam-totp');
var SteamCommunity = require('steamcommunity');
var community = new SteamCommunity();
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

var manager = new TradeOfferManager({
	"steam": client,
	"domain": "nothinghere",
	"language": "en"
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

function exists(id) {
  for (var i = 0; i < config.acceptSteamIDS.length; i++) {
    if (config.acceptSteamIDS[i] == id) {
      return true;
    }
    return false;
  }
}

manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteamID64());
	if (exists(offer.partner.getSteamID64())) {
		offer.accept(function(err) {
			if (err) {
				console.log("Unable to accept offer: " + err.message);
			} else if (exists(offer.partner.getSteamID64()) == true) {
			  console.log("Offer Accepted from "+offer.partner.getSteamID64());
			}
		});
	}
});
