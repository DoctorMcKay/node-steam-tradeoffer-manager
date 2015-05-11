/**
 * Represents the various possible states for a {@link TradeOffer}.
 * @readonly
 * @enum {number}
 * @memberof TradeOfferManager
 */
var ETradeOfferState = {
	"Invalid": 1,
	/** This trade offer has been sent, neither party has acted on it yet. */
	"Active": 2,
	/** The trade offer was accepted by the recipient and items were exchanged. */
	"Accepted": 3,
	/** The recipient made a counter offer */
	"Countered": 4,
	/** The trade offer was not accepted before the expiration date */
	"Expired": 5,
	/** The sender cancelled the offer */
	"Canceled": 6,
	/** The recipient declined the offer */
	"Declined": 7,
	/** Some of the items in the offer are no longer available (indicated by the missing flag in the output) */
	"InvalidItems": 8,
	/** The receiver cancelled the offer via email */
	"EmailCanceled": 10
};

module.exports = ETradeOfferState;
