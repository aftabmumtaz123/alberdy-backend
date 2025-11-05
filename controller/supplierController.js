const Supplier = require('../model/Supplier');
const Joi = require('joi');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const supplierSchema = Joi.object({
  supplierName: Joi.string().min(2).required(),
  supplierCode: Joi.string().optional(),
  contactPerson: Joi.string().allow('').optional(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required(),
  supplierType: Joi.string().required(),
  address: Joi.object({
    street: Joi.string().allow('').optional(),
    city: Joi.string().allow('').optional(),
    state: Joi.string().allow('').optional(),
    zip: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
  }).optional(),
  status: Joi.string().valid('Active', 'Inactive').default('Active'),
});

// Create a new supplier
exports.createSupplier = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = supplierSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.reduce((acc, err) => {
        acc[err.path.join('.')] = err.message;
        return acc;
      }, {});
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    const {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      address,
      status,
    } = value;

    // Check for existing email
    const existingEmail = await Supplier.findOne({ email: email.trim() });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: { email: 'Email already exists' },
      });
    }

    // Generate unique supplierCode if not provided
    let supplierCodeToUse = supplierCode?.trim();
    if (!supplierCodeToUse) {
      supplierCodeToUse = `SUP-${uuidv4().substring(0, 8).toUpperCase()}`;
      while (await Supplier.findOne({ supplierCode: supplierCodeToUse })) {
        supplierCodeToUse = `SUP-${uuidv4().substring(0, 8).toUpperCase()}`;
      }
    } else if (await Supplier.findOne({ supplierCode: supplierCodeToUse })) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: { supplierCode: 'Supplier code already exists' },
      });
    }

    // Handle uploaded files
    const attachments = req.files
      ? req.files.map(file => ({
          fileName: file.originalname,
          filePath: file.path,
          uploadedAt: new Date(),
        }))
      : [];

    // Create supplier
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
      status,
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
};

// Get all suppliers
exports.getAllSuppliers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order === 'desc' ? -1 : 1;

    // Build query for filtering
    const query = { status: { $ne: 'Deleted' } }; // Exclude deleted suppliers
    if (req.query.status) query.status = req.query.status;
    if (req.query.supplierType) query.supplierType = req.query.supplierType;
    if (req.query.search) {
      query.$or = [
        { supplierName: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
        { supplierCode: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const suppliers = await Supplier.find(query)
      .sort({ [sortBy]: order })
      .skip(skip)
      .limit(limit);
    const totalSuppliers = await Supplier.countDocuments(query);

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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    }

    const supplier = await Supplier.findOne({ _id: id, status: { $ne: 'Deleted' } });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
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
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    }

    // Validate request body
    const { error, value } = supplierSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.reduce((acc, err) => {
        acc[err.path.join('.')] = err.message;
        return acc;
      }, {});
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    const {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      address,
      status,
    } = value;

    // Check for existing email or supplierCode
    if (email) {
      const existingEmail = await Supplier.findOne({
        email: email.trim(),
        _id: { $ne: id },
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: { email: 'Email already exists' },
        });
      }
    }
    if (supplierCode) {
      const existingCode = await Supplier.findOne({
        supplierCode: supplierCode.trim(),
        _id: { $ne: id },
      });
      if (existingCode) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: { supplierCode: 'Supplier code already exists' },
        });
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

    // Build update object
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
      ...(attachments.length > 0 && { $push: { attachments: { $each: attachments } } }),
    };

    const supplier = await Supplier.findOneAndUpdate(
      { _id: id, status: { $ne: 'Deleted' } },
      updateData,
      { new: true, runValidators: true }
    );

    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
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
};

// Delete a supplier (soft delete)
exports.deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    }

    const supplier = await Supplier.findOne({ _id: id, status: { $ne: 'Deleted' } });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    // Soft delete
    supplier.status = 'Deleted';
    supplier.deletedAt = new Date();
    await supplier.save();

 

    res.status(200).json({ success: true, message: 'Supplier marked as deleted' });
  } catch (error) {
    console.error('Delete Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting supplier',
      error: error.message,
    });
  }
};