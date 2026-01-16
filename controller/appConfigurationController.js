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
      tax,
      enableStoreDiscount,
      discountPercentage,
      minimumOrderAmount,
      maxDiscountAmount,
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

    const discountEnabled = enableStoreDiscount === true || enableStoreDiscount === 'true';
if (discountEnabled) {
      const perc = Number(discountPercentage);
      const minOrder = Number(minimumOrderAmount);
      const maxDisc = Number(maxDiscountAmount);

      if (isNaN(perc) || perc < 0 || perc > 100) {
        return res.status(400).json({
          success: false,
          message: 'Discount percentage must be 0–100',
        });
      }
      if (isNaN(minOrder) || minOrder < 0) {
        return res.status(400).json({
          success: false,
          message: 'Minimum order amount must be ≥ 0',
        });
      }
      if (isNaN(maxDisc) || maxDisc < 0) {
        return res.status(400).json({
          success: false,
          message: 'Max discount amount must be ≥ 0',
        });
      }

      // Optional business rule: max discount should not be ridiculously small when percentage > 0
      if (perc > 0 && maxDisc === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please set a reasonable maximum discount amount when discount % > 0',
        });
      }
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
      enableStoreDiscount: discountEnabled,
      discountPercentage: discountEnabled ? Number(discountPercentage) : 0,
      minimumOrderAmount: discountEnabled ? Number(minimumOrderAmount) : 0,
      maxDiscountAmount: discountEnabled ? Number(maxDiscountAmount) : 0,
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid configuration ID',
      });
    }

    
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
      tax,
      enableStoreDiscount,
      discountPercentage,
      minimumOrderAmount,
      maxDiscountAmount,
    } = req.body;

    
    const appLogo = req.file ? req.file.path : undefined;

    
    const existingConfig = await Configuration.findById(id);
    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found',
      });
    }

    
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

    // ── Discount logic ──
    const discountEnabled = enableStoreDiscount !== undefined 
      ? (enableStoreDiscount === true || enableStoreDiscount === 'true')
      : existing.enableStoreDiscount;

    let discountUpdate = {};
    if (discountEnabled) {
      const perc = discountPercentage !== undefined ? Number(discountPercentage) : existing.discountPercentage;
      const minOrd = minimumOrderAmount !== undefined ? Number(minimumOrderAmount) : existing.minimumOrderAmount;
      const maxD = maxDiscountAmount !== undefined ? Number(maxDiscountAmount) : existing.maxDiscountAmount;

      if (perc < 0 || perc > 100) {
        return res.status(400).json({ success: false, message: 'Discount % must be 0–100' });
      }
      if (minOrd < 0) {
        return res.status(400).json({ success: false, message: 'Min order amount ≥ 0' });
      }
      if (maxD < 0) {
        return res.status(400).json({ success: false, message: 'Max discount ≥ 0' });
      }

      discountUpdate = {
        enableStoreDiscount: true,
        discountPercentage: perc,
        minimumOrderAmount: minOrd,
        maxDiscountAmount: maxD,
      };
    } else {
      discountUpdate = {
        enableStoreDiscount: false,
        discountPercentage: 0,
        minimumOrderAmount: 0,
        maxDiscountAmount: 0,
      };
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
      ...discountUpdate,
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
