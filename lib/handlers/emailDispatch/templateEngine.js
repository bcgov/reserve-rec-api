/**
 * Template Engine for Email Dispatch using Handlebars
 * Supports local templates and S3-stored templates
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { logger, Exception } = require("/opt/base");
const path = require('path');
const fs = require('fs').promises;
const { generateQRURL } = require('./qrCodeHelper');

// We'll add Handlebars to package.json dependencies
let Handlebars;
try {
  Handlebars = require('handlebars');
} catch (error) {
  logger.warn('Handlebars not found, template compilation will fail');
}

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const s3Client = new S3Client({ region: AWS_REGION });

class TemplateEngine {
  constructor(options = {}) {
    this.templateBucket = options.templateBucket;
    this.locale = options.locale || 'en';
    this.templateCache = new Map();
    this.useLocalTemplates = !this.templateBucket;
    
    // Register Handlebars helpers
    this.registerHelpers();
  }

  /**
   * Register custom Handlebars helpers
   */
  registerHelpers() {
    if (!Handlebars) return;

    // Currency formatting helper
    Handlebars.registerHelper('currency', function(amount, currency = 'CAD') {
      if (typeof amount !== 'number') return amount;
      
      // Convert from cents to dollars
      const dollars = amount / 100;
      
      if (currency === 'CAD') {
        return new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD'
        }).format(dollars);
      }
      
      return `$${dollars.toFixed(2)}`;
    });

    // Date formatting helper
    Handlebars.registerHelper('formatDate', function(dateString, format = 'long') {
      if (!dateString) return '';
      
      const date = new Date(dateString);
      const options = {
        short: { year: 'numeric', month: 'short', day: 'numeric' },
        long: { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        },
        time: { 
          hour: '2-digit', 
          minute: '2-digit',
          timeZoneName: 'short'
        }
      };
      
      return new Intl.DateTimeFormat('en-CA', options[format] || options.long)
        .format(date);
    });

    // Conditional helper
    Handlebars.registerHelper('if_eq', function(a, b, opts) {
      if (a === b) {
        return opts.fn(this);
      } else {
        return opts.inverse(this);
      }
    });

    // Pluralization helper
    Handlebars.registerHelper('pluralize', function(count, singular, plural) {
      return count === 1 ? singular : plural;
    });

    // French locale helper
    Handlebars.registerHelper('t', function(key, options) {
      const translations = this.translations || {};
      return translations[key] || key;
    });

    /**
     * QR code helper - displays QR code image if present in booking object
     * Usage: {{qrCode booking}}
     * Returns: <img> tag with base64 QR code or empty string if not available
     * 
     * Note: QR code must be pre-generated in email dispatch handler before
     * template rendering since Handlebars helpers must be synchronous
     */
    Handlebars.registerHelper('qrCode', function(booking) {
      try {
        if (!booking || !booking.qrCodeDataUrl) {
          logger.debug('QR code helper: no QR code data URL available');
          return '';
        }

        // Return safe HTML string with QR code image
        const imgTag = `<img src="${booking.qrCodeDataUrl}" alt="Booking QR Code" style="display: block; width: 200px; height: 200px; margin: 0 auto;" />`;
        return new Handlebars.SafeString(imgTag);
      } catch (error) {
        logger.error('Error in qrCode helper', { error: error.message });
        return '';
      }
    });

    /**
     * QR verification URL helper - generates verification URL from booking
     * Usage: {{qrVerificationUrl booking}}
     * Returns: https://domain/verify/bookingId/hash
     */
    Handlebars.registerHelper('qrVerificationUrl', function(booking) {
      try {
        if (!booking || !booking.bookingId) {
          return '';
        }
        
        // Use pre-generated URL if available, otherwise generate it
        if (booking.qrVerificationUrl) {
          return booking.qrVerificationUrl;
        }
        
        return generateQRURL(booking.bookingId);
      } catch (error) {
        logger.error('Error in qrVerificationUrl helper', { error: error.message });
        return '';
      }
    });
  }

  /**
   * Load template files (HTML and text versions)
   * @param {string} templateName - Template identifier (e.g., 'receipt_bcparks_kootenay')
   * @returns {Object} Template object with html and text properties
   */
  async loadTemplate(templateName) {
    const cacheKey = `${templateName}_${this.locale}`;
    
    // Check cache first
    if (this.templateCache.has(cacheKey)) {
      logger.info('Loading template from cache', { templateName, locale: this.locale });
      return this.templateCache.get(cacheKey);
    }

    let templates;
    
    if (this.useLocalTemplates) {
      templates = await this.loadLocalTemplate(templateName);
    } else {
      templates = await this.loadS3Template(templateName);
    }

    if (templates) {
      // Cache the compiled templates
      this.templateCache.set(cacheKey, templates);
      logger.info('Template loaded and cached', { templateName, locale: this.locale });
    }

    return templates;
  }

  /**
   * Load template from local filesystem
   * @param {string} templateName - Template identifier
   * @returns {Object} Template object
   */
  async loadLocalTemplate(templateName) {
    try {
      const templateDir = path.join(__dirname, 'templates', this.locale);
      const htmlPath = path.join(templateDir, `${templateName}.html`);
      const textPath = path.join(templateDir, `${templateName}.txt`);

      const [htmlContent, textContent] = await Promise.all([
        fs.readFile(htmlPath, 'utf8').catch(() => null),
        fs.readFile(textPath, 'utf8').catch(() => null)
      ]);

      if (!htmlContent && !textContent) {
        logger.warn('No template files found', { templateName, templateDir });
        return null;
      }

      const templates = {};
      if (htmlContent && Handlebars) {
        templates.html = Handlebars.compile(htmlContent);
      }
      if (textContent && Handlebars) {
        templates.text = Handlebars.compile(textContent);
      }

      return templates;
    } catch (error) {
      logger.error('Failed to load local template', {
        templateName,
        error: error.message
      });
      throw new Exception('Template loading failed', {
        code: 500,
        templateName,
        error: error.message
      });
    }
  }

  /**
   * Load template from S3
   * @param {string} templateName - Template identifier
   * @returns {Object} Template object
   */
  async loadS3Template(templateName) {
    try {
      const htmlKey = `${this.locale}/${templateName}.html`;
      const textKey = `${this.locale}/${templateName}.txt`;

      const [htmlContent, textContent] = await Promise.all([
        this.getS3Object(htmlKey).catch(() => null),
        this.getS3Object(textKey).catch(() => null)
      ]);

      if (!htmlContent && !textContent) {
        logger.warn('No template files found in S3', { 
          templateName, 
          bucket: this.templateBucket,
          locale: this.locale 
        });
        return null;
      }

      const templates = {};
      if (htmlContent && Handlebars) {
        templates.html = Handlebars.compile(htmlContent);
      }
      if (textContent && Handlebars) {
        templates.text = Handlebars.compile(textContent);
      }

      return templates;
    } catch (error) {
      logger.error('Failed to load S3 template', {
        templateName,
        bucket: this.templateBucket,
        error: error.message
      });
      throw new Exception('S3 template loading failed', {
        code: 500,
        templateName,
        error: error.message
      });
    }
  }

  /**
   * Get object from S3
   * @param {string} key - S3 object key
   * @returns {string} Object content
   */
  async getS3Object(key) {
    const command = new GetObjectCommand({
      Bucket: this.templateBucket,
      Key: key
    });

    const response = await s3Client.send(command);
    return response.Body.transformToString();
  }

  /**
   * Render template with data
   * @param {Object} templates - Compiled template object
   * @param {Object} data - Template data
   * @returns {Object} Rendered content (html and text)
   */
  async renderTemplate(templates, data) {
    try {
      const result = {};

      // Add locale-specific translations to data
      const enhancedData = {
        ...data,
        translations: await this.getTranslations(),
        locale: this.locale
      };

      if (templates.html) {
        result.html = templates.html(enhancedData);
      }

      if (templates.text) {
        result.text = templates.text(enhancedData);
      }

      // Fallback: generate plain text from HTML if no text template
      if (result.html && !result.text) {
        result.text = this.htmlToText(result.html);
      }

      logger.info('Template rendered successfully', {
        hasHtml: !!result.html,
        hasText: !!result.text
      });

      return result;
    } catch (error) {
      logger.error('Template rendering failed', {
        error: error.message,
        stack: error.stack
      });
      throw new Exception('Template rendering failed', {
        code: 500,
        error: error.message
      });
    }
  }

  /**
   * Get locale-specific translations
   * @returns {Object} Translation object
   */
  async getTranslations() {
    const translations = {
      en: {
        'booking.confirmation': 'Booking Confirmation',
        'booking.receipt': 'Receipt',
        'booking.details': 'Booking Details',
        'payment.total': 'Total Amount',
        'customer.info': 'Customer Information',
        'contact.us': 'Contact Us',
        'thank.you': 'Thank you for choosing BC Parks!'
      },
      fr: {
        'booking.confirmation': 'Confirmation de réservation',
        'booking.receipt': 'Reçu',
        'booking.details': 'Détails de la réservation',
        'payment.total': 'Montant total',
        'customer.info': 'Informations client',
        'contact.us': 'Contactez-nous',
        'thank.you': 'Merci d\'avoir choisi les parcs de la C.-B.!'
      }
    };

    return translations[this.locale] || translations.en;
  }

  /**
   * Simple HTML to text conversion
   * @param {string} html - HTML content
   * @returns {string} Plain text content
   */
  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = {
  TemplateEngine
};