"use strict";

module.exports = EconItem;

function EconItem(item) {
	for (let thing in item) {
		if (item.hasOwnProperty(thing)) {
			this[thing] = item[thing];
		}
	}

	if (this.id || this.assetid) {
		this.assetid = this.id = (this.id || this.assetid).toString();
	} else if (this.currencyid) {
		this.currencyid = this.currencyid.toString();
	}

	this.appid = this.appid ? parseInt(this.appid, 10) : 0;
	this.classid = this.classid.toString();
	this.instanceid = (this.instanceid || 0).toString();
	this.amount = this.amount ? parseInt(this.amount, 10) : 1;
	this.contextid = this.contextid.toString();

	this.fraudwarnings = fixArray(this.fraudwarnings);
	this.descriptions = fixArray(this.descriptions);
	this.owner_descriptions = fixArray(this.owner_descriptions);
	this.actions = fixArray(this.actions);
	this.owner_actions = fixArray(this.owner_actions);
	this.tags = fixArray(this.tags);

	this.tradable = !!parseInt(this.tradable, 10);
	this.marketable = !!parseInt(this.marketable, 10);
	this.commodity = !!parseInt(this.commodity, 10);
	this.market_tradable_restriction = (this.market_tradable_restriction ? parseInt(this.market_tradable_restriction, 10) : 0);
	this.market_marketable_restriction = (this.market_marketable_restriction ? parseInt(this.market_marketable_restriction, 10) : 0);
}

function fixArray(obj) {
	if (typeof obj === 'undefined' || obj == '') {
		return [];
	}

	var array = [];
	for (var i in obj) {
		if (obj.hasOwnProperty(i)) {
			array[i] = obj[i];
		}
	}

	return array;
}

EconItem.prototype.getImageURL = function() {
	return "https://steamcommunity-a.akamaihd.net/economy/image/" + this.icon_url + "/";
};

EconItem.prototype.getLargeImageURL = function() {
	if (!this.icon_url_large) {
		return this.getImageURL();
	}

	return "https://steamcommunity-a.akamaihd.net/economy/image/" + this.icon_url_large + "/";
};

EconItem.prototype.getTag = function(category) {
	if (!this.tags) {
		return null;
	}

	for (let i = 0; i < this.tags.length; i++) {
		if (this.tags[i].category == category) {
			return this.tags[i];
		}
	}

	return null;
};
