const Supplier = require('../model/Supplier');
const Order = require('../model/Order');
const cloudinary = require('cloudinary').v2;

// ==================== HELPER: Normalize Address ====================
const normalizeAddress = (address) => {
  if (!address) return undefined;

  let addrObj = address;

  // If it's a string (sent from frontend as JSON string or double-stringified)
  if (typeof address === 'string') {
    try {
      addrObj = JSON.parse(address);
    } catch (e) {
      // If parsing fails, treat as empty
      addrObj = {};
    }
  }

  // Ensure it's an object
  if (typeof addrObj !== 'object' || addrObj === null) {
    addrObj = {};
  }

  return {
    street: addrObj.street?.trim() || '',
    city: addrObj.city?.trim() || '',
    state: addrObj.state?.trim() || '',
    zip: addrObj.zip?.trim() || '',
    country: addrObj.country?.trim() || '',
  };
};

// ==================== CREATE SUPPLIER ====================
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
    } = req.body;

    // Required validations
    if (!supplierName || supplierName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Supplier name must be at least 2 characters' });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    if (!supplierType || supplierType.trim() === '') {
      return res.status(400).json({ success: false, message: 'Supplier type is required' });
    }

    // Unique checks
    if (await Supplier.findOne({ email: email.trim() }).countDocuments() > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    let supplierCodeToUse = supplierCode?.trim();
    if (!supplierCodeToUse) {
      do {
        supplierCodeToUse = `SUP-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      } while (await Supplier.findOne({ supplierCode: supplierCodeToUse }));
    } else if (await Supplier.findOne({ supplierCode: supplierCodeToUse })) {
      return res.status(400).json({ success: false, message: 'Supplier code already exists' });
    }

    const statusToUse = ['Active', 'Inactive'].includes(status) ? status : 'Active';

    const attachments = req.files?.map(file => ({
      fileName: file.originalname,
      filePath: file.path, // Cloudinary URL
      uploadedAt: new Date(),
    })) || [];

    const supplier = await Supplier.create({
      supplierName: supplierName.trim(),
      supplierCode: supplierCodeToUse,
      contactPerson: contactPerson?.trim() || '',
      email: email.trim(),
      phone: phone?.trim() || '',
      supplierType: supplierType.trim(),
      address: normalizeAddress(address),
      status: statusToUse,
      attachments,
    });

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: supplier,
    });
  } catch (error) {
    console.error('Create Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== GET ALL SUPPLIERS ====================
exports.getAllSuppliers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [suppliers, total] = await Promise.all([
      Supplier.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Supplier.countDocuments(),
    ]);

    res.json({
      success: true,
      message: 'Suppliers fetched successfully',
      data: suppliers,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (error) {
    console.error('Fetch Suppliers Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==================== GET SUPPLIER BY ID ====================
exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id)
      .select('-__v')
      .populate({
        path: 'paymentHistory',
        select: 'totalAmount amountPaid amountDue paymentMethod invoiceNo status date notes createdAt',
        options: { sort: { date: -1 } },
      });

    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const ordersCount = await Order.countDocuments({ supplier: supplier._id });

    res.json({
      success: true,
      data: {
        ...supplier.toObject(),
        ordersCount,
      },
    });
  } catch (err) {
    console.error('Get supplier error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==================== UPDATE SUPPLIER ====================
exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    let {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      address,
      status,
      attachments: existingAttachments = '[]', // sent from frontend as JSON string
    } = req.body;

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    // === Validations ===
    if (supplierName && supplierName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name too short' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    if (email && email.trim() !== supplier.email) {
      if (await Supplier.findOne({ email: email.trim(), _id: { $ne: id } })) {
        return res.status(400).json({ success: false, message: 'Email already used' });
      }
    }

    if (supplierCode?.trim() && supplierCode.trim() !== supplier.supplierCode) {
      if (await Supplier.findOne({ supplierCode: supplierCode.trim(), _id: { $ne: id } }).countDocuments() > 0) {
        return res.status(400).json({ success: false, message: 'Code already exists' });
      }
    }

    // === Handle Attachments (Preserve old + add new) ===
    let parsedExisting = [];
    try {
      parsedExisting = JSON.parse(existingAttachments);
      if (!Array.isArray(parsedExisting)) parsedExisting = [];
    } catch (e) {
      parsedExisting = [];
    }

    const newUploaded = req.files?.map(file => ({
      fileName: file.originalname,
      filePath: file.path,
      uploadedAt: new Date(),
    })) || [];

    const finalAttachments = [...parsedExisting, ...newUploaded];

    // === Build Update Object ===
    const updateData = {
      ...(supplierName && { supplierName: supplierName.trim() }),
      ...(supplierCode && { supplierCode: supplierCode.trim() }),
      ...(contactPerson !== undefined && { contactPerson: contactPerson.trim() || '' }),
      ...(email && { email: email.trim() }),
      ...(phone !== undefined && { phone: phone.trim() || '' }),
      ...(supplierType && { supplierType: supplierType.trim() }),
      ...(address !== undefined && { address: normalizeAddress(address) }),
      ...(status && { status }),
      attachments: finalAttachments,
    };

    const updatedSupplier = await Supplier.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: 'Supplier updated successfully',
      data: updatedSupplier,
    });
  } catch (error) {
    console.error('Update Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// ==================== DELETE SUPPLIER ====================
exports.deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await Supplier.findById(id);

    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    // Delete files from Cloudinary
    if (supplier.attachments?.length > 0) {
      for (const att of supplier.attachments) {
        try {
          const publicId = att.filePath.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`Uploads/${publicId}`);
        } catch (err) {
          console.warn('Failed to delete from Cloudinary:', att.filePath);
        }
      }
    }

    await Supplier.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Supplier and attachments deleted successfully',
    });
  } catch (error) {
    console.error('Delete Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};