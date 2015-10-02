module.exports = {
	"Invalid": 1,
	"Active": 2,            // This trade offer has been sent, neither party has acted on it yet.
	"Accepted": 3,          // The trade offer was accepted by the recipient and items were exchanged.
	"Countered": 4,         // The recipient made a counter offer
	"Expired": 5,           // The trade offer was not accepted before the expiration date
	"Canceled": 6,          // The sender cancelled the offer
	"Declined": 7,          // The recipient declined the offer
	"InvalidItems": 8,      // Some of the items in the offer are no longer available (indicated by the missing flag in the output)
	"EmailPending": 9,      // The offer hasn't been sent yet and is awaiting email confirmation
	"EmailCanceled": 10     // Either party canceled the offer via email
};
