const Supplier = require('../model/Supplier');

// Create a new supplier
exports.createSupplier = async (req, res) => {
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
      attachments,
    } = req.body;

    const errors = {};

    // 🔹 Manual field validations
    if (!supplierName || supplierName.trim().length < 2) {
      errors.supplierName = 'Supplier name is required and must be at least 2 characters long';
    }

      const existingEmail = await Supplier.findOne({ email });
      if (existingEmail) {
        errors.email = 'Email already exists';
      }
    

    if (!phone || !/^\+?\d{10,15}$/.test(phone)) {
      errors.phone = 'Valid phone number is required (10-15 digits, optional + prefix)';
    }

    if (!supplierType || supplierType.trim() === '') {
      errors.supplierType = 'Supplier type is required';
    }

    if (address && address.trim() === '') {
      errors.address = 'Address cannot be empty if provided';
    }

    const allowedStatus = ['Active', 'Inactive'];
    const statusToUse = status && allowedStatus.includes(status) ? status : 'Active';

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
      address: address?.trim(),
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

// Get a single supplier by ID
exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await Supplier.findById(id).select('-__v');

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
      attachments,
    } = req.body;

    const errors = {};

    // 🔹 Manual field validations
    if (supplierName && supplierName.trim().length < 2) {
      errors.supplierName = 'Supplier name must be at least 2 characters long';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Valid email is required';
    } else if (email) {
      // Check email uniqueness, excluding the current supplier
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

    if (address && address.trim() === '') {
      errors.address = 'Address cannot be empty if provided';
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
      ...(address && { address: address.trim() }),
      ...(status && { status }),
      ...(attachments && { attachments }),
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