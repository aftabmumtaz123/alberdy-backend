const Supplier = require('../model/Supplier');
const Order = require('../model/Order');
const upload = require('../config/multer');
const cloudinary = require('cloudinary').v2;

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

    // --- Required Field Validations ---
    if (!supplierName || supplierName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name must be at least 2 characters',
      });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Valid email is required',
      });
    }

    if (!supplierType || supplierType.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Supplier type is required',
      });
    }

    // --- Unique Checks ---
    const emailExists = await Supplier.findOne({ email: email.trim() });
    if (emailExists) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
      });
    }

    let supplierCodeToUse = supplierCode?.trim();
    if (!supplierCodeToUse) {
      let isUnique = false;
      while (!isUnique) {
        supplierCodeToUse = `SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        if (!(await Supplier.findOne({ supplierCode: supplierCodeToUse }))) {
          isUnique = true;
        }
      }
    } else {
      const codeExists = await Supplier.findOne({ supplierCode: supplierCodeToUse });
      if (codeExists) {
        return res.status(400).json({
          success: false,
          message: 'Supplier code already exists',
        });
      }
    }

    // --- Parse Address ---
    if (address && typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Address must be valid JSON',
        });
      }
    }

    const statusToUse = ['Active', 'Inactive'].includes(status) ? status : 'Active';

    // --- Handle File Uploads ---
    const attachments = req.files
      ? req.files.map(file => ({
        fileName: file.originalname,
        filePath: file.path, // Cloudinary secure_url
        uploadedAt: new Date(),
      }))
      : [];

    // --- Create Supplier ---
    const supplier = new Supplier({
      supplierName: supplierName.trim(),
      supplierCode: supplierCodeToUse,
      contactPerson: contactPerson?.trim(),
      email: email.trim(),
      phone: phone?.trim(),
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
};

// ==================== GET ALL SUPPLIERS ====================
exports.getAllSuppliers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const suppliers = await Supplier.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalSuppliers = await Supplier.countDocuments();

    res.status(200).json({
      success: true,
      message: 'Suppliers fetched successfully',
      data: suppliers,
      pagination: {
        total: totalSuppliers,
        page,
        pages: Math.ceil(totalSuppliers / limit),
        limit,
      },
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
// ==================== GET SUPPLIER BY ID (FINAL & BULLETPROOF) ====================
exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id)
      .select('-__v')
      .populate({
        path: 'paymentHistory',
        select: 'totalAmount amountPaid amountDue paymentMethod invoiceNo status date notes createdAt',
        options: { sort: { date: -1 } },
      })
      .lean(); // ← THIS IS THE KEY: Converts to plain JS object EARLY

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Count orders
    const ordersCount = await Order.countDocuments({ supplier: supplier._id });

    // Ensure attachments always have full data (even if somehow missing)
    const safeAttachments = (supplier.attachments || []).map(att => ({
      _id: att._id || undefined,
      fileName: att.fileName || 'Unknown file',
      filePath: att.filePath || '',
      uploadedAt: att.uploadedAt || new Date(),
    }));

    // Final clean response
    res.json({
      success: true,
      data: {
        ...supplier,
        attachments: safeAttachments,
        ordersCount,
      },
    });
  } 
  catch (err) {
    console.error('Get supplier error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error fetching supplier',
      error: err.message,
    });
  }
};



// exports.updateSupplier = async (req, res) => {
//   try {
//     const { id } = req.params;

//     let {
//       supplierName,
//       supplierCode,
//       contactPerson,
//       email,
//       phone,
//       supplierType,
//       address,
//       status,
//       attachments, // ← Full current list from frontend (most important)
//     } = req.body;

//     // Parse address
//     if (address && typeof address === 'string') {
//       try { address = JSON.parse(address); } catch {
//         return res.status(400).json({ success: false, message: 'Invalid address JSON' });
//       }
//     }

//     // === Validations (same as before) ===
//     if (supplierName && supplierName.trim().length < 2)
//       return res.status(400).json({ success: false, message: 'Name too short' });

//     if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
//       return res.status(400).json({ success: false, message: 'Invalid email' });

//     if (email) {
//       const exists = await Supplier.findOne({ email: email.trim(), _id: { $ne: id } });
//       if (exists) return res.status(400).json({ success: false, message: 'Email already used' });
//     }

//     if (supplierCode?.trim()) {
//       const exists = await Supplier.findOne({ supplierCode: supplierCode.trim(), _id: { $ne: id } });
//       if (exists) return res.status(400).json({ success: false, message: 'Code already exists' });
//     }

//     // === Build new attachments list ===
//     let finalAttachments = [];

//     if (attachments) {
//       try {
//         const list = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
//         if (Array.isArray(list)) {
//           finalAttachments = list.map(att => ({
//             fileName: att.fileName,
//             filePath: att.filePath,
//             uploadedAt: att.uploadedAt || new Date(),
//           }));
//         }
//       } catch (e) { /* ignore */ }
//     }


//     // === Update supplier ===
//     const updateData = {
//       ...(supplierName && { supplierName: supplierName.trim() }),
//       ...(supplierCode && { supplierCode: supplierCode.trim() }),
//       ...(contactPerson && { contactPerson: contactPerson.trim() }),
//       ...(email && { email: email.trim() }),
//       ...(phone && { phone: phone.trim() }),
//       ...(supplierType && { supplierType: supplierType.trim() }),
//       ...(address && {
//         address: {
//           street: address.street?.trim(),
//           city: address.city?.trim(),
//           state: address.state?.trim(),
//           zip: address.zip?.trim(),
//           country: address.country?.trim(),
//         },
//       }),
//       ...(status && { status }),
//       attachments: finalAttachments, // ← Just replace everything
//     };

//     const supplier = await Supplier.findByIdAndUpdate(id, updateData, {
//       new: true,
//       runValidators: true,
//     });

//     if (!supplier) {
//       return res.status(404).json({ success: false, message: 'Supplier not found' });
//     }

//     res.json({
//       success: true,
//       message: 'Supplier updated successfully',
//       data: supplier,
//     });

//   } catch (error) {
//     console.error('Update Supplier Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message,
//     });
//   }
// };



exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get current supplier to delete old files from Cloudinary
    const currentSupplier = await Supplier.findById(id);
    if (!currentSupplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    // 2. Delete ALL old files from Cloudinary (if any)
    if (currentSupplier.attachments && currentSupplier.attachments.length > 0) {
      for (const att of currentSupplier.attachments) {
        try {
          const publicId = att.filePath.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`Uploads/${publicId}`);
          console.log('Deleted from Cloudinary:', publicId);
        } catch (err) {
          console.warn('Failed to delete old file:', att.filePath);
        }
      }
    }

    // 3. Build new attachments ONLY from what user uploads NOW
    let finalAttachments = [];

    if (req.files && req.files.length > 0) {
      finalAttachments = req.files.map(file => ({
        fileName: file.originalname,
        filePath: file.path, // Cloudinary URL
        uploadedAt: new Date(),
      }));
    }

    // Optional: Allow max 5
    if (finalAttachments.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 attachments allowed',
      });
    }

    const { attachments, ...cleanBody } = req.body;

    const updated = await Supplier.findByIdAndUpdate(
      id,
      {
        $set: {
          ...cleanBody,
          attachments: finalAttachments, // ← Only new files
        },
      },
      { new: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: 'Supplier updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update Supplier Error:', error);
    return res.status(500).json({
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
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Optional: Delete all attachments from Cloudinary
    if (supplier.attachments && supplier.attachments.length > 0) {
      for (const att of supplier.attachments) {
        try {
          const publicId = att.filePath.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`Uploads/${publicId}`);
        } catch (err) {
          console.warn('Failed to delete attachment:', att.filePath);
        }
      }
    }

    await Supplier.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Supplier and attachments deleted successfully',
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