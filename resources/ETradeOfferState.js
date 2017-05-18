module.exports = {
	Invalid: 1,
	// This trade offer has been sent, neither party has acted on it yet.
	Active: 2,
	// The trade offer was accepted by the recipient and items were exchanged.
	Accepted: 3,
	// The recipient made a counter offer
	Countered: 4,
	// The trade offer was not accepted before the expiration date
	Expired: 5,
	// The sender cancelled the offer
	Canceled: 6,
	// The recipient declined the offer
	Declined: 7,
	// Some of the items in the offer are no longer available
	// (indicated by the missing flag in the output)
	InvalidItems: 8,
	// The offer hasn't been sent yet and is awaiting further confirmation
	CreatedNeedsConfirmation: 9,
	// Either party canceled the offer via email/mobile confirmation
	CanceledBySecondFactor: 10,
	// The trade has been placed on hold
	InEscrow: 11,

	1: 'Invalid',
	2: 'Active',
	3: 'Accepted',
	4: 'Countered',
	5: 'Expired',
	6: 'Canceled',
	7: 'Declined',
	8: 'InvalidItems',
	9: 'CreatedNeedsConfirmation',
	10: 'CanceledBySecondFactor',
	11: 'InEscrow',
};
