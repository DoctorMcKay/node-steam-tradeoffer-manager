// Required Modules
const SteamUser = require('steam-user'),
const SteamTotp = require('steam-totp'),
const TradeOfferManager = require('steam-tradeoffer-manager'),
const SteamCommunity = require('steamcommunity');
 
// Initiate Modules
let client = new SteamUser();
let community = new SteamCommunity(),
let manager = new TradeOfferManager({
    "steam": client,
    "domain": "nothinghere",
    "language": "en"
});
 
let config = {
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
 
// Start sign in process
client.logOn({
    "accountName": config.username,
    "password": config.password,
    "twoFactorCode": SteamTotp.generateAuthCode(config.sharedSecret)
});
 
// Events (user signed in, cookies retrieved, new offer retrieved)
client.on('loggedOn', () => {
    console.log(`Logged into Steam as ${client.steamID.getSteam3RenderedID()}`);
    client.setPersona(SteamUser.EPersonaState.Online);
});
 
client.on('webSession', (sessionID, cookies) => {
    manager.setCookies(cookies, err =>  {
        if (err) {
            console.error(err);
            return process.exit(1);
        } else console.log(`Retrieved API key: ${manager.apiKey}`);
    });
 
    community.setCookies(cookies);
    community.startConfirmationChecker(30000, config.identitySecret);
});
 
manager.on('newOffer', offer => {
    console.log(`New offer #${offer.id} from ${offer.partner.getSteamID64()}`);
 
    // Check to make sure that the steam id of the offer partner is whitelisted, else decline
    if(config.acceptSteamIDS.includes(offer.partner.getSteamID64())) {
        offer.accept(err => {
            if(err) console.log(`Error accepting offer: ${err.message}`)
            else    console.log(`Success accepting offer from: ${offer.partner.getSteamID64()}`);
        });
    } else offer.decline();
});
