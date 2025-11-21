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

    let {
      supplierName,
      supplierCode,
      contactPerson,
      email,
      phone,
      supplierType,
      address,
      status,
      attachments, // ← This must be the current list of files user wants to KEEP (from frontend)
    } = req.body;

    // === Parse address if sent as JSON string ===
    if (address && typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: 'Invalid address JSON format',
        });
      }
    }

    // === Basic Validations ===
    if (supplierName && supplierName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name must be at least 2 characters',
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    // === Unique Checks (exclude current supplier) ===
    if (email) {
      const emailExists = await Supplier.findOne({
        email: email.trim(),
        _id: { $ne: id },
      });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email is already used by another supplier',
        });
      }
    }

    if (supplierCode && supplierCode.trim()) {
      const codeExists = await Supplier.findOne({
        supplierCode: supplierCode.trim(),
        _id: { $ne: id },
      });
      if (codeExists) {
        return res.status(400).json({
          success: false,
          message: 'Supplier code already exists',
        });
      }
    }

    // === Get current supplier to compare attachments and delete removed files ===
    const currentSupplier = await Supplier.findById(id);
    if (!currentSupplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // === Build Final Attachments List ===
    let finalAttachments = [];

    // Step 1: Files user wants to KEEP (sent from frontend)
    if (attachments) {
      try {
        const keptList = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;

        if (Array.isArray(keptList)) {
          finalAttachments = keptList.map(att => ({
            fileName: att.fileName || att.originalname,
            filePath: att.filePath || att.path,
            uploadedAt: att.uploadedAt ? new Date(att.uploadedAt) : new Date(),
            _id: att._id || undefined, // preserve MongoDB sub-document _id
          }));
        }
      } catch (e) {
        console.warn('Failed to parse kept attachments:', e);
      }
    }

    // Step 2: Add newly uploaded files
    if (req.files && req.files.length > 0) {
      const newFiles = req.files.map(file => ({
        fileName: file.originalname,
        filePath: file.path, // Cloudinary secure_url
        uploadedAt: new Date(),
      }));

      finalAttachments = [...finalAttachments, ...newFiles];
    }

    // Step 3: Enforce max 5 files
    if (finalAttachments.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 attachments are allowed',
      });
    }

    // === Delete Removed Files from Cloudinary ===
    if (currentSupplier.attachments && currentSupplier.attachments.length > 0) {
      const oldPaths = currentSupplier.attachments.map(a => a.filePath);
      const newPaths = finalAttachments.map(a => a.filePath);

      const removedPaths = oldPaths.filter(path => !newPaths.includes(path));

      for (const filePath of removedPaths) {
        try {
          // Extract public_id from Cloudinary URL
          const urlParts = filePath.split('/');
          const fileName = urlParts[urlParts.length - 1];
          const publicId = fileName.split('.')[0]; // remove extension

          await cloudinary.uploader.destroy(`Uploads/${publicId}`);
          console.log('Deleted from Cloudinary:', publicId);
        } catch (err) {
          console.warn('Failed to delete file from Cloudinary:', filePath, err.message);
          // Don't fail the whole update if Cloudinary delete fails
        }
      }
    }

    // === Prepare Update Data ===
    const updateData = {
      ...(supplierName && { supplierName: supplierName.trim() }),
      ...(supplierCode && { supplierCode: supplierCode.trim() }),
      ...(contactPerson && { contactPerson: contactPerson.trim() }),
      ...(email && { email: email.trim() }),
      ...(phone && { phone: phone?.trim() }),
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
      ...(status && ['Active', 'Inactive'].includes(status) && { status }),
      attachments: finalAttachments,
    };

    // === Perform Update ===
    const updatedSupplier = await Supplier.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedSupplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      data: updatedSupplier,
    });
  } catch (error) {
    console.error('Update Supplier Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating supplier',
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