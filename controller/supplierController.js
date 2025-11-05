const Supplier = require('../model/Supplier'); // Fixed typo

// Create a new supplier
exports.createSupplier = async (req, res) => {
  try {
    let {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      address,
      status,
      attachments
    } = req.body;

    const errors = {};

    // 🔹 Manual field validations
    if (!supplierName || supplierName.trim().length < 2) {
      errors.supplierName = 'Supplier name is required and must be at least 2 characters long';
    }

   

    

    if (!supplierType || supplierType.trim() === '') {
      errors.supplierType = 'Supplier type is required';
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
      // Check if custom code already exists
      const existing = await Supplier.findOne({ supplierCode: supplierCodeToUse });
      if (existing) {
        errors.supplierCode = 'Supplier code already exists';
      }
    }

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
};

// Get all suppliers
exports.getAllSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find()
      .sort({ createdAt: -1 })
      .select('-__v');

    res.status(200).json({
      success: true,
      message: 'Suppliers fetched successfully',
      total: suppliers.length,
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