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


// ==================== UPDATE SUPPLIER (100% WORKING VERSION) ====================
exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    // === SAFELY PARSE JSON FIELDS FROM FORM-DATA ===
    const rawBody = req.body;

    // Parse attachmentsToKeep (comes as string from form-data)
    let attachmentsToKeep = rawBody.attachmentsToKeep || '[]';
    if (typeof attachmentsToKeep === 'string') {
      try {
        attachmentsToKeep = JSON.parse(attachmentsToKeep);
      } catch (e) {
        console.warn('Failed to parse attachmentsToKeep, defaulting to []');
        attachmentsToKeep = [];
      }
    }
    if (!Array.isArray(attachmentsToKeep)) attachmentsToKeep = [];

    // Parse address if sent as JSON string
    let address = rawBody.address;
    if (typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch (e) {
        address = {};
      }
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    // === HANDLE ATTACHMENTS ===
    const oldAttachments = supplier.attachments || [];

    // Keep only the ones client wants to retain
    const keptAttachments = oldAttachments.filter(att =>
      attachmentsToKeep.includes(att.filePath)
    );

    // Delete removed ones from Cloudinary
    const removedAttachments = oldAttachments.filter(
      att => !attachmentsToKeep.includes(att.filePath)
    );

    for (const att of removedAttachments) {
      try {
        // Extract public_id correctly from Cloudinary URL
        const urlParts = att.filePath.split('/');
        const publicIdWithExt = urlParts.slice(-2).join('/').split('.')[0]; // Handles folder + filename
        const publicId = publicIdWithExt.startsWith('Uploads/')
          ? publicIdWithExt
          : `Uploads/${publicIdWithExt}`;

        await cloudinary.uploader.destroy(publicId);
        console.log('Deleted from Cloudinary:', publicId);
      } catch (err) {
        console.warn('Failed to delete from Cloudinary:', att.filePath, err.message);
      }
    }

    // New files uploaded now
    const newAttachments = (req.files || []).map(file => ({
      fileName: file.originalname,
      filePath: file.path, // Cloudinary full URL
      uploadedAt: new Date(),
    }));

    const finalAttachments = [...keptAttachments, ...newAttachments];

    // === UPDATE OTHER FIELDS ===
    const updateData = {
      supplierName: rawBody.supplierName?.trim() || supplier.supplierName,
      contactPerson: rawBody.contactPerson?.trim() ?? supplier.contactPerson,
      email: rawBody.email?.trim() || supplier.email,
      phone: rawBody.phone?.trim() ?? supplier.phone,
      supplierType: rawBody.supplierType?.trim() || supplier.supplierType,
      address: normalizeAddress(address),
      status: ['Active', 'Inactive'].includes(rawBody.status) ? rawBody.status : supplier.status,
      attachments: finalAttachments,
    };

    const updatedSupplier = await Supplier.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

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