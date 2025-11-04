const Supplier = require('../model/Suppliar');

// Create a new supplier
exports.createSupplier = async (req, res) => {
  try {
    const {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      status,
      attachments
    } = req.body;

    // 🔹 Manual field validations
    const errors = {};

    if (!supplierName || supplierName.trim().length < 2) {
      errors.supplierName = 'Supplier name is required and must be at least 2 characters long';
    }

    if (!supplierCode || !/^[A-Z0-9_-]+$/.test(supplierCode)) {
      errors.supplierCode = 'Supplier code is required and must contain only uppercase letters, numbers, underscores, or hyphens';
    }

    if (email && !/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/.test(email)) {
      errors.email = 'Invalid email address format';
    }

    if (phone && !/^\+?[0-9]{10,15}$/.test(phone)) {
      errors.phone = 'Invalid phone number format';
    }

    const allowedTypes = ['Electronics', 'Grocery', 'Clothing', 'Accessories', 'Furniture', 'Other'];
    if (!supplierType || !allowedTypes.includes(supplierType)) {
      errors.supplierType = 'Supplier type must be one of: ' + allowedTypes.join(', ');
    }

    const allowedStatus = ['Active', 'Inactive'];
    if (status && !allowedStatus.includes(status)) {
      errors.status = 'Status must be Active or Inactive';
    }

    // If manual validation failed
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    // 🔹 Save supplier
    const supplier = new Supplier({
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
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

  

    const suppliers = await Supplier.find(filter)
      .sort({ createdAt: -1 }) // newest first
      .select('-__v'); 

   

    res.status(200).json({
      success: true,
      message: 'Suppliers fetched successfully',
      total: suppliers.length,
      data: suppliers,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching suppliers',
      error: error.message,
    });
  }
};