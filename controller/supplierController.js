const Supplier = require('../model/Supplier');
const upload = require('../config/multer'); 

// Create a new supplier
exports.createSupplier = async (req, res) => {
  upload.array('attachments', 5)(req, res, async (err) => {
    if (err) {
      console.error('Multer Error:', err);
      return res.status(400).json({
        success: false,
        message: 'File upload failed',
        error: err.message,
      });
    }

    try {
      if (!req.body) {
        return res.status(400).json({
          success: false,
          message: 'Request body is missing',
        });
      }

      let {
        supplierName,
        supplierCode,
        contactPerson,
        email,
        phone,
        supplierType,
        address,
        status,
      } = req.body;

      const errors = {};

      // 🔹 Manual field validations
      if (!supplierName || supplierName.trim().length < 2) {
        errors.supplierName = 'Supplier name is required and must be at least 2 characters long';
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Valid email is required';
      } else {
        const existingEmail = await Supplier.findOne({ email: email.trim() });
        if (existingEmail) {
          errors.email = 'Email already exists';
        }
      }

      if (!phone || !/^\+?\d{10,15}$/.test(phone)) {
        errors.phone = 'Valid phone number is required (10-15 digits, optional + prefix)';
      }

      if (!supplierType || supplierType.trim() === '') {
        errors.supplierType = 'Supplier type is required';
      }

      // Validate address object
      if (address) {
        try {
          address = typeof address === 'string' ? JSON.parse(address) : address;
          if (address.street && address.street.trim() === '') {
            errors['address.street'] = 'Street cannot be empty if provided';
          }
          if (address.city && address.city.trim() === '') {
            errors['address.city'] = 'City cannot be empty if provided';
          }
          if (address.state && address.state.trim() === '') {
            errors['address.state'] = 'State cannot be empty if provided';
          }
          if (address.zip && address.zip.trim() === '') {
            errors['address.zip'] = 'Zip code cannot be empty if provided';
          }
          if (address.country && address.country.trim() === '') {
            errors['address.country'] = 'Country cannot be empty if provided';
          }
        } catch (e) {
          errors.address = 'Invalid address format; must be a valid JSON object';
        }
      }

      const allowedStatus = ['Active', 'Inactive'];
      const statusToUse = status && allowedStatus.includes(status) ? status : 'Active';

      // Generate unique supplierCode if not provided
      let supplierCodeToUse = supplierCode?.trim();
      if (!supplierCodeToUse) {
        let isUnique = false;
        while (!isUnique) {
          const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          supplierCodeToUse = `SUP-${randomCode}`;
          const existing = await Supplier.findOne({ supplierCode: supplierCodeToUse });
          if (!existing) isUnique = true;
        }
      } else {
        const existing = await Supplier.findOne({ supplierCode: supplierCodeToUse });
        if (existing) {
          errors.supplierCode = 'Supplier code already exists';
        }
      }

      // Handle uploaded files
      const attachments = req.files
        ? req.files.map(file => ({
            fileName: file.originalname,
            filePath: file.path,
            uploadedAt: new Date(),
          }))
        : [];

      // Return validation errors
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors,
        });
      }

      // 🔹 Save supplier
      const supplier = new Supplier({
        supplierName: supplierName.trim(),
        supplierCode: supplierCodeToUse,
        contactPerson: contactPerson?.trim(),
        email: email.trim(),
        phone: phone.trim(),
        supplierType: supplierType.trim(),
        address: address
          ? {
              street: address.street?.trim(),
              city: address.city?.trim(),
              state: address.state?.trim(),
              zip: address.zip?.trim(),
              country: address.country?.trim(),
            }
          : undefined,
        status: statusToUse,
        attachments,
      });

      await supplier.save();

      res.status(201).json({
        success: true,
        message: 'Supplier created successfully',
        data: supplier,
      });
    } catch (error) {
      console.error('Create Supplier Error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error occurred while creating supplier',
        error: error.message,
      });
    }
  });
};

// Get all suppliers
exports.getAllSuppliers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const suppliers = await Supplier.find()
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)

    const totalSuppliers = await Supplier.countDocuments();

    res.status(200).json({
      success: true,
      message: 'Suppliers fetched successfully',
      total: totalSuppliers,
      currentPage: page,
      totalPages: Math.ceil(totalSuppliers / limit),
      count: suppliers.length,
      data: suppliers,
    });
  } catch (error) {
    console.error('Fetch Suppliers Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching suppliers',
      error: error.message,
    });
  }
};

// Get a single supplier by ID
exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findById(id)

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Supplier fetched successfully',
      data: supplier,
    });
  } catch (error) {
    console.error('Fetch Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching supplier',
      error: error.message,
    });
  }
};

// Update a supplier
exports.updateSupplier = async (req, res) => {
  upload.array('attachments', 5)(req, res, async (err) => {
    if (err) {
      console.error('Multer Error:', err);
      return res.status(400).json({
        success: false,
        message: 'File upload failed',
        error: err.message,
      });
    }

    try {
      const { id } = req.params;
      if (!req.body) {
        return res.status(400).json({
          success: false,
          message: 'Request body is missing',
        });
      }

      let {
        supplierName,
        supplierCode,
        contactPerson,
        email,
        phone,
        supplierType,
        address,
        status,
      } = req.body;

      const errors = {};

      // 🔹 Manual field validations
      if (supplierName && supplierName.trim().length < 2) {
        errors.supplierName = 'Supplier name must be at least 2 characters long';
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Valid email is required';
      } else if (email) {
        const existingEmail = await Supplier.findOne({
          email: email.trim(),
          _id: { $ne: id },
        });
        if (existingEmail) {
          errors.email = 'Email already exists';
        }
      }

      if (phone && !/^\+?\d{10,15}$/.test(phone)) {
        errors.phone = 'Valid phone number is required (10-15 digits, optional + prefix)';
      }

      if (supplierType && supplierType.trim() === '') {
        errors.supplierType = 'Supplier type cannot be empty';
      }

      // Validate address object
      if (address) {
        try {
          address = typeof address === 'string' ? JSON.parse(address) : address;
          if (address.street && address.street.trim() === '') {
            errors['address.street'] = 'Street cannot be empty if provided';
          }
          if (address.city && address.city.trim() === '') {
            errors['address.city'] = 'City cannot be empty if provided';
          }
          if (address.state && address.state.trim() === '') {
            errors['address.state'] = 'State cannot be empty if provided';
          }
          if (address.zip && address.zip.trim() === '') {
            errors['address.zip'] = 'Zip code cannot be empty if provided';
          }
          if (address.country && address.country.trim() === '') {
            errors['address.country'] = 'Country cannot be empty if provided';
          }
        } catch (e) {
          errors.address = 'Invalid address format; must be a valid JSON object';
        }
      }

      if (status && !['Active', 'Inactive'].includes(status)) {
        errors.status = 'Status must be either Active or Inactive';
      }

      if (supplierCode && supplierCode.trim()) {
        const existingCode = await Supplier.findOne({
          supplierCode: supplierCode.trim(),
          _id: { $ne: id },
        });
        if (existingCode) {
          errors.supplierCode = 'Supplier code already exists';
        }
      }

      // Handle uploaded files (append to existing attachments)
      let attachments = [];
      if (req.files && req.files.length > 0) {
        attachments = req.files.map(file => ({
          fileName: file.originalname,
          filePath: file.path,
          uploadedAt: new Date(),
        }));
      }

      // Return validation errors
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors,
        });
      }

      // 🔹 Update supplier
      const updateData = {
        ...(supplierName && { supplierName: supplierName.trim() }),
        ...(supplierCode && { supplierCode: supplierCode.trim() }),
        ...(contactPerson && { contactPerson: contactPerson.trim() }),
        ...(email && { email: email.trim() }),
        ...(phone && { phone: phone.trim() }),
        ...(supplierType && { supplierType: supplierType.trim() }),
        ...(address && {
          address: {
            street: address.street?.trim(),
            city: address.city?.trim(),
            state: address.state?.trim(),
            zip: address.zip?.trim(),
            country: address.country?.trim(),
          },
        }),
        ...(status && { status }),
        ...(attachments.length > 0 && { $push: { attachments: { $each: attachments } } }), // Append new attachments
      };

      const supplier = await Supplier.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      });

      if (!supplier) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found',
        });
      }

      res.status(200).json({
        success: true,
        message: 'Supplier updated successfully',
        data: supplier,
      });
    } catch (error) {
      console.error('Update Supplier Error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error occurred while updating supplier',
        error: error.message,
      });
    }
  });
};

// Delete a supplier
exports.deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findByIdAndDelete(id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Supplier deleted successfully',
    });
  } catch (error) {
    console.error('Delete Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting supplier',
      error: error.message,
    });
  }
};