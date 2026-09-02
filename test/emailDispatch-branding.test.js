/**
 * Confirmation email branding and links (#731).
 *
 * Renders the real template with real Handlebars — the suite in
 * emailDispatch.test.js mocks Handlebars out, so it cannot see markup.
 */
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const TEMPLATE_DIR = path.join(__dirname, '..', 'lib', 'handlers', 'emailDispatch', 'templates', 'en');
const ASSET_DIR = path.join(__dirname, '..', 'lib', 'handlers', 'emailDispatch', 'assets');

Handlebars.registerHelper('pluralize', (count, singular, plural) => (count === 1 ? singular : plural));
Handlebars.registerHelper('formatDate', () => 'Monday, September 7, 2026');
Handlebars.registerHelper('formatTime', () => '7 am');

const template = Handlebars.compile(
  fs.readFileSync(path.join(TEMPLATE_DIR, 'confirmation_bcparks_default.html'), 'utf8')
);

const BASE_DATA = {
  booking: {
    bookingId: 'abc-123',
    invQuantity: 2,
    productName: 'Vehicle parking',
    arrivalDate: 1757250000000,
    departureDate: 1757278800000,
  },
  customer: { firstName: 'Jo', lastName: 'Tester' },
  location: { parkName: 'Joffre Lakes Park' },
  branding: {},
};

function render(overrides = {}) {
  return template({
    ...BASE_DATA,
    booking: { ...BASE_DATA.booking, ...(overrides.booking || {}) },
    branding: { ...BASE_DATA.branding, ...(overrides.branding || {}) },
  });
}

describe('confirmation email branding', () => {
  it('ships the images the template references', () => {
    for (const file of ['bcparks-logo.png', 'icon-pin.png', 'icon-ticket.png']) {
      expect(fs.existsSync(path.join(ASSET_DIR, file))).toBe(true);
    }
  });

  it('renders the logo from its Content-ID', () => {
    const html = render({ branding: { logoCid: 'bcparks-logo' } });

    expect(html).toContain('src="cid:bcparks-logo"');
    expect(html).toContain('alt="BC Parks"');
  });

  it('falls back to the wordmark when the logo did not load', () => {
    const html = render();

    expect(html).not.toContain('src="cid:');
    expect(html).toContain('header-wordmark');
  });

  // Icon fonts do not render in email; these have to be images.
  it('puts the pin and ticket icons beside their values', () => {
    const html = render({ branding: { pinCid: 'icon-pin', ticketCid: 'icon-ticket' } });

    expect(html).toContain('src="cid:icon-pin"');
    expect(html).toContain('src="cid:icon-ticket"');
  });
});

describe('confirmation email cancellation section', () => {
  it('offers the cancel link when the URL is present', () => {
    const html = render({ booking: { cancellationUrl: 'https://example.invalid/account/bookings/cancel/abc-123' } });

    expect(html).toContain('Cancel your reservation');
    expect(html).toContain('https://example.invalid/account/bookings/cancel/abc-123');
  });

  // DUP has no refunds, so the section must not imply one (Lindsay, #731).
  it('says nothing about refunds', () => {
    const html = render({ booking: { cancellationUrl: 'https://example.invalid/cancel' } });

    expect(html.toLowerCase()).not.toContain('refund');
  });

  it('omits the section when no URL was built', () => {
    expect(render()).not.toContain('Cancel your reservation');
  });

  // Gmail on Android drops the default underline on a bare mailto.
  it('underlines the contact address explicitly', () => {
    expect(render()).toContain('mailto:parkinfo@gov.bc.ca" style="text-decoration: underline;"');
  });
});
