module.exports = EconItem;

function EconItem(item) {
	var thing;
	for(thing in item) {
		if(item.hasOwnProperty(thing)) {
			this[thing] = item[thing];
		}
	}

	this.assetid = this.id = (this.id || this.assetid).toString();
	this.classid = this.classid.toString();
	this.instanceid = this.instanceid ? this.instanceid.toString() : '0';
	this.amount = this.amount ? parseInt(this.amount, 10) : 1;
	this.contextid = this.contextid.toString();

	this.fraudwarnings = fixArray(this.fraudwarnings);
	this.descriptions = fixArray(this.descriptions);
	this.actions = fixArray(this.actions);
	this.tags = fixArray(this.tags);

	this.tradable = !!this.tradable;
	this.marketable = !!this.marketable;
	this.commodity = !!this.commodity;
	this.market_tradable_restriction = (this.market_tradable_restriction ? parseInt(this.market_tradable_restriction, 10) : 0);
	this.market_marketable_restriction = (this.market_marketable_restriction ? parseInt(this.market_marketable_restriction, 10) : 0);
}

function fixArray(obj) {
	if(typeof obj === 'undefined') {
		return undefined;
	}

	if(obj == '') {
		return [];
	}

	var array = [];
	for(var i in obj) {
		if(obj.hasOwnProperty(i)) {
			array[i] = obj[i];
		}
	}

	return array;
}

EconItem.prototype.getImageURL = function() {
	return "https://steamcommunity-a.akamaihd.net/economy/image/" + this.icon_url + "/";
};

EconItem.prototype.getLargeImageURL = function() {
	if(!this.icon_url_large) {
		return this.getImageURL();
	}

	return "https://steamcommunity-a.akamaihd.net/economy/image/" + this.icon_url_large + "/";
};

EconItem.prototype.getTag = function(category) {
	if(!this.tags) {
		return null;
	}

	for(var i = 0; i < this.tags.length; i++) {
		if(this.tags[i].category == category) {
			return this.tags[i];
		}
	}

	return null;
};
