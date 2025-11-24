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



const fs = require("fs");


// ==================== UPDATE SUPPLIER – FINAL VERSION (Single "attachments" field) ====================
exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    // Parse regular fields (some may come as stringified JSON from form-data)
    const {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      address: addressRaw,
      status,
      // attachments comes from both req.body (text URLs) and req.files (uploaded files)
    } = req.body;

    // Safely parse address if sent as JSON string
    let addressObj = {};
    if (addressRaw) {
      if (typeof addressRaw === 'string') {
        try { addressObj = JSON.parse(addressRaw); } catch (e) { /* ignore */ }
      } else if (typeof addressRaw === 'object') {
        addressObj = addressRaw;
      }
    }

    // Find existing supplier
    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    // === 1. HANDLE ATTACHMENTS (The Magic Part) ===
    const oldAttachments = supplier.attachments || [];

    // All values sent under key "attachments" (can be strings OR files)
    const incomingAttachments = req.body.attachments || [];

    // Normalize to array
    const incomingList = Array.isArray(incomingAttachments)
      ? incomingAttachments
      : [incomingAttachments].filter(Boolean);

    // Extract URLs (old files to keep) – they are plain strings starting with http
    const urlsToKeep = incomingList
      .filter(item => typeof item === 'string' && item.trim().startsWith('http'))
      .map(url => url.trim());

    // New files actually uploaded in this request
    const newUploadedFiles = req.files || [];

    // Determine which old files were NOT sent back → delete them
    const removedAttachments = oldAttachments.filter(
      att => !urlsToKeep.includes(att.filePath)
    );

    // Delete removed files from Cloudinary
    for (const att of removedAttachments) {
      try {
        // Extract public_id correctly (handles folder + filename)
        const urlPath = att.filePath.split('/').slice(7).join('/'); // remove https://res.cloudinary.com/.../v123/
        const publicId = urlPath.split('.')[0]; // remove extension
        await cloudinary.uploader.destroy(publicId);
        console.log('Deleted from Cloudinary:', publicId);
      } catch (err) {
        console.warn('Failed to delete from Cloudinary:', att.filePath, err.message);
      }
    }

    // Build new attachment records from uploaded files
    const newAttachments = newUploadedFiles.map(file => ({
      fileName: file.originalname,
      filePath: file.path,        // Cloudinary full URL
      uploadedAt: new Date(),
    }));

    // Final attachments = kept old + newly uploaded
    const finalAttachments = [
      ...oldAttachments.filter(att => urlsToKeep.includes(att.filePath)),
      ...newAttachments,
    ];

    // === 2. BUILD UPDATE OBJECT ===
    const updateData = {
      ...(supplierName && { supplierName: supplierName.trim() }),
      ...(supplierCode && { supplierCode: supplierCode.trim() }),
      ...(contactPerson !== undefined && { contactPerson: contactPerson?.trim() || '' }),
      ...(email && { email: email.trim() }),
      ...(phone !== undefined && { phone: phone?.trim() || '' }),
      ...(supplierType && { supplierType: supplierType.trim() }),
      ...(addressObj && { address: normalizeAddress(addressObj) }),
      ...(status && ['Active', 'Inactive'].includes(status) && { status }),
      attachments: finalAttachments,
    };

    // === 3. UPDATE & RETURN ===
    const updatedSupplier = await Supplier.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: "Supplier updated successfully",
      data: updatedSupplier,
    });

  } catch (error) {
    console.error("Update Supplier Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message || error.toString(),
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