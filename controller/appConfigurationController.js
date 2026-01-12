const Configuration = require("../model/app_configuration");
const cloudinary = require("cloudinary").v2;
const mongoose = require('mongoose');

exports.createAppConfiguration = async (req, res) => {
  try {

    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Request body is missing',
      });
    }

    const {
      appName,
      primaryColor,
      secondaryColor,
      facebook,
      aboutUs,
      contactEmails,
      supportPhones,
      instagram,
      youtube,
      linkedin,
      street_address,
      zip_code,
      currencyName,
      currencyCode,
      currencySign,
      tax
    } = req.body;
    const appLogo = req.file ? req.file.path : ''; 

    if (!appName || !primaryColor || !secondaryColor || !currencyName || !currencyCode || !currencySign) {
      return res.status(400).json({
        success: false,
        message: 'App Name, Primary Color, Secondary Color, Currency Name, Currency Code, and Currency Sign are required',
      });
    }

    // Validate color formats (hex or rgb)
    const validateColor = (color) => /^#([0-9A-F]{3}|[0-9A-F]{6})|rgb\(\d{1,3}%?,\s*\d{1,3}%?,\s*\d{1,3}%?\)$/i.test(color);
    if (!validateColor(primaryColor)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Primary Color format (e.g., #FF0000 or rgb(255, 0, 0))',
      });
    }
    if (!validateColor(secondaryColor)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Secondary Color format (e.g., #123456 or rgb(0, 128, 255))',
      });
    }

    // Validate currency fields
    if (!/^[A-Za-z\s]{1,50}$/.test(currencyName)) {
      return res.status(400).json({
        success: false,
        message: 'Currency Name must be 1-50 letters or spaces (e.g., US Dollar)',
      });
    }
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      return res.status(400).json({
        success: false,
        message: 'Currency Code must be a 3-letter ISO 4217 code (e.g., USD, EUR)',
      });
    }
    if (!/^[\p{Sc}A-Za-z]{1,5}$/u.test(currencySign)) {
      return res.status(400).json({
        success: false,
        message: 'Currency Sign must be 1-5 characters (e.g., $, €, USD)',
      });
    }

    // Validate social fields as URLs if provided
    const validateUrl = (url) => url ? /^https?:\/\/.+/.test(url) : true;
    if (!validateUrl(facebook) || !validateUrl(instagram) || !validateUrl(youtube) || !validateUrl(linkedin)) {
      return res.status(400).json({
        success: false,
        message: 'Social links must be valid URLs if provided',
      });
    }

    // Validate arrays if provided
    if (contactEmails && !Array.isArray(contactEmails)) {
      return res.status(400).json({
        success: false,
        message: 'contactEmails must be an array',
      });
    }
    if (supportPhones && !Array.isArray(supportPhones)) {
      return res.status(400).json({
        success: false,
        message: 'supportPhones must be an array',
      });
    }

    // Check for duplicate appName
    const existingConfig = await Configuration.findOne({ appName });
    if (existingConfig) {
      return res.status(400).json({
        success: false,
        message: 'Configuration with this App Name already exists',
      });
    }

    // Create configuration
    const configuration = await Configuration.create({
      appName,
      appLogo,
      primaryColor,
      secondaryColor,
      aboutUs: aboutUs || '',
      contactEmails: contactEmails || [],
      supportPhones: supportPhones || [],
      facebook: facebook || '',
      instagram: instagram || '',
      youtube: youtube || '',
      linkedin: linkedin || '',
      street_address: street_address || '',
      zip_code: zip_code || '',
      currencyName,
      currencyCode,
      tax,
      currencySign,
      lastUpdated: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: 'Configuration created successfully',
      configuration,
    });
  } catch (error) {
    // Handle Cloudinary file cleanup on error
    if (req.file && req.file.filename) {
      await cloudinary.uploader.destroy(req.file.filename).catch(err => console.error('Cloudinary cleanup failed:', err));
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors).map(e => e.message).join(', '),
      });
    } else if (error.name === 'MongoError' && error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate key error (e.g., appName already exists)',
      });
    } else {
      console.error('Error creating configuration:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
};

exports.getAppConfigurationById = async (req, res) => {
  try {

    // Find configuration
    const configuration = await Configuration.find().lean(); // Use findById instead of find

    if (!configuration) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Configuration fetched successfully',
      configuration,
    });
  } catch (error) {
    console.error('Error fetching configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

exports.updateAppConfiguration = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid configuration ID',
      });
    }

    // Destructure fields from body
    const {
      appName,
      primaryColor,
      secondaryColor,
      aboutUs,
      contactEmails,
      supportPhones,
      facebook,
      instagram,
      youtube,
      linkedin,
      street_address,
      zip_code,
      currencyName,
      currencyCode,
      currencySign,
      tax
    } = req.body;

    // Get new logo if uploaded
    const appLogo = req.file ? req.file.path : undefined;

    // Find existing configuration
    const existingConfig = await Configuration.findById(id);
    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found',
      });
    }

    // Prevent empty required fields
    if (
      appName === '' ||
      primaryColor === '' ||
      secondaryColor === '' ||
      currencyName === '' ||
      currencyCode === '' ||
      currencySign === ''
    ) {
      return res.status(400).json({
        success: false,
        message: 'appName, primaryColor, secondaryColor, currencyName, currencyCode, and currencySign cannot be empty',
      });
    }

    // Validate color formats (hex or rgb)
    if (primaryColor && !/^#([0-9A-F]{3}|[0-9A-F]{6})|rgb\(\d{1,3}%?,\s*\d{1,3}%?,\s*\d{1,3}%?\)$/i.test(primaryColor)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Primary Color format (e.g., #FF0000 or rgb(255, 0, 0))',
      });
    }
    if (secondaryColor && !/^#([0-9A-F]{3}|[0-9A-F]{6})|rgb\(\d{1,3}%?,\s*\d{1,3}%?,\s*\d{1,3}%?\)$/i.test(secondaryColor)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Secondary Color format (e.g., #123456 or rgb(0, 128, 255))',
      });
    }

    // Validate currency fields
    if (currencyName && !/^[A-Za-z\s]{1,50}$/.test(currencyName)) {
      return res.status(400).json({
        success: false,
        message: 'Currency Name must be 1-50 letters or spaces (e.g., US Dollar)',
      });
    }
    if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
      return res.status(400).json({
        success: false,
        message: 'Currency Code must be a 3-letter ISO 4217 code (e.g., USD, EUR)',
      });
    }
    if (currencySign && !/^[\p{Sc}A-Za-z]{1,5}$/u.test(currencySign)) {
      return res.status(400).json({
        success: false,
        message: 'Currency Sign must be 1-5 characters (e.g., $, €, USD)',
      });
    }

    // Validate social fields as URLs if provided
    const validateUrl = (url) => url ? /^https?:\/\/.+/.test(url) : true;
    if (!validateUrl(facebook) || !validateUrl(instagram) || !validateUrl(youtube) || !validateUrl(linkedin)) {
      return res.status(400).json({
        success: false,
        message: 'Social links must be valid URLs if provided',
      });
    }

    // Arrays validation
    if (contactEmails && !Array.isArray(contactEmails)) {
      return res.status(400).json({
        success: false,
        message: 'contactEmails must be an array',
      });
    }
    if (supportPhones && !Array.isArray(supportPhones)) {
      return res.status(400).json({
        success: false,
        message: 'supportPhones must be an array',
      });
    }

    // Check duplicate appName
    if (appName && appName !== existingConfig.appName) {
      const duplicateConfig = await Configuration.findOne({ appName });
      if (duplicateConfig) {
        return res.status(400).json({
          success: false,
          message: 'Configuration with this appName already exists',
        });
      }
    }

    // Build update data
    const updateData = {
      appName: appName ?? existingConfig.appName,
      primaryColor: primaryColor ?? existingConfig.primaryColor,
      secondaryColor: secondaryColor ?? existingConfig.secondaryColor,
      aboutUs: aboutUs ?? existingConfig.aboutUs,
      contactEmails: contactEmails ?? existingConfig.contactEmails,
      supportPhones: supportPhones ?? existingConfig.supportPhones,
      facebook: facebook ?? existingConfig.facebook,
      instagram: instagram ?? existingConfig.instagram,
      youtube: youtube ?? existingConfig.youtube,
      linkedin: linkedin ?? existingConfig.linkedin,
      street_address: street_address ?? existingConfig.street_address,
      zip_code: zip_code ?? existingConfig.zip_code,
      currencyName: currencyName ?? existingConfig.currencyName,
      currencyCode: currencyCode ?? existingConfig.currencyCode,
      currencySign: currencySign ?? existingConfig.currencySign,
      tax: tax ?? existingConfig.tax,
      lastUpdated: new Date().toISOString(),
    };

    // Handle logo update
    if (appLogo) {
      if (existingConfig.appLogo) {
        const publicId = existingConfig.appLogo.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(publicId).catch(err => console.error('Failed to delete old logo:', err));
      }
      updateData.appLogo = appLogo;
    }

    // Update configuration
    const updatedConfig = await Configuration.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Configuration updated successfully',
      configuration: updatedConfig,
    });
  } catch (error) {
    // Handle Cloudinary file cleanup on error
    if (req.file?.filename) {
      await cloudinary.uploader.destroy(req.file.filename).catch(err => console.error('Cloudinary cleanup failed:', err));
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors).map(e => e.message).join(', '),
      });
    } else {
      console.error('Error updating configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
};
