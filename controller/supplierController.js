const Supplier = require('../model/Supplier');
const upload = require('../config/multer'); 
const Order = require('../model/Order')

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

    const errors = {};



    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Valid email required';
    } else if (await Supplier.findOne({ email })) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
      });
    }

 

    if (!supplierType || supplierType.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Supplier type is required',
      });
    }

    if (address) {
      try {
        address = typeof address === 'string' ? JSON.parse(address) : address;
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Address must be valid JSON',
        });
      }
    }

    const allowedStatus = ['Active', 'Inactive'];
    const statusToUse = allowedStatus.includes(status) ? status : 'Active';

    let supplierCodeToUse = supplierCode?.trim();
    if (!supplierCodeToUse) {
      let isUnique = false;
      while (!isUnique) {
        const randomCode = `SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        if (!(await Supplier.findOne({ supplierCode: randomCode }))) {
          supplierCodeToUse = randomCode;
          isUnique = true;
        }
      }
    } else if (await Supplier.findOne({ supplierCode: supplierCodeToUse })) {
      return res.status(400).json({
        success: false,
        message: 'Supplier code already exists',
      });
    }

    const attachments = req.files
      ? req.files.map(f => ({
          fileName: f.originalname,
          filePath: f.path,
          uploadedAt: new Date(),
        }))
      : [];

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors occurred',
        errors,
      });
    }

    const supplier = new Supplier({
      supplierName: supplierName.trim(),
      supplierCode: supplierCodeToUse,
      contactPerson: contactPerson?.trim(),
      email: email.trim(),
      phone: phone.trim(),
      supplierType: supplierType.trim(),
      address: {
        street: address?.street?.trim(),
        city: address?.city?.trim(),
        state: address?.state?.trim(),
        zip: address?.zip?.trim(),
        country: address?.country?.trim(),
      },
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit);
    const skip = (page - 1) * limit;

    const suppliers = await Supplier.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)

    const totalSuppliers = await Supplier.countDocuments();

    res.status(200).json({
      success: true,
      message: 'Suppliers fetched successfully',
      data: suppliers,
      total: totalSuppliers,
      currentPage: page,
      totalPages: Math.ceil(totalSuppliers / limit),
      count: suppliers.length,
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
      return res.status(404).json({ success: false, msg: 'Supplier not found' });
    }

    const ordersCount = await Order.countDocuments({ supplier: supplier._id });

    const response = {
      ...supplier.toObject(),
      ordersCount,
    };

    res.json({ success: true, data: response });
  } catch (err) {
    console.error('Get supplier error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching supplier' });
  }
}

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
      attachments, // ← Expect updated list from frontend (array of objects)
      removedAttachmentIds, // ← Optional: array of Cloudinary public_ids or _ids to delete
    } = req.body;

    // Parse address if string
    if (address && typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: 'Address must be valid JSON',
        });
      }
    }

    // === Validations (same as before) ===
    if (supplierName && supplierName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name must be at least 2 characters',
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Valid email is required',
      });
    }

    if (email) {
      const existingEmail = await Supplier.findOne({
        email: email.trim(),
        _id: { $ne: id },
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists',
        });
      }
    }

    if (status && !['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either Active or Inactive',
      });
    }

    if (supplierCode && supplierCode.trim()) {
      const existingCode = await Supplier.findOne({
        supplierCode: supplierCode.trim(),
        _id: { $ne: id },
      });
      if (existingCode) {
        return res.status(400).json({
          success: false,
          message: 'Supplier code already exists',
        });
      }
    }

    // === Get current supplier to preserve existing attachments ===
    const currentSupplier = await Supplier.findById(id);
    if (!currentSupplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Start with existing attachments
    let updatedAttachments = [...currentSupplier.attachments];

    // Option 1: If frontend sends full `attachments` array → replace all
    if (attachments && Array.isArray(attachments)) {
      try {
        updatedAttachments = JSON.parse(attachments); // if sent as string
      } catch {
        // already parsed
      }
    }

    // Option 2: Remove specific attachments by public_id or _id
    if (removedAttachmentIds) {
      let idsToRemove;
      try {
        idsToRemove = typeof removedAttachmentIds === 'string'
          ? JSON.parse(removedAttachmentIds)
          : removedAttachmentIds;
      } catch {
        idsToRemove = [];
      }

      if (Array.isArray(idsToRemove) && idsToRemove.length > 0) {
        // Optional: Delete from Cloudinary
        for (const publicId of idsToRemove) {
          try {
            // Extract public_id from URL or use directly
            const id = publicId.includes('/') ? publicId.split('/').pop().split('.')[0] : publicId;
            await cloudinary.uploader.destroy(`Uploads/${id}`);
          } catch (err) {
            console.warn('Failed to delete from Cloudinary:', publicId, err.message);
            // Don't fail the whole update
          }
        }

        // Remove from array
        updatedAttachments = updatedAttachments.filter(
          att => !idsToRemove.includes(att.filePath) && 
                 !idsToRemove.includes(att._id?.toString())
        );
      }
    }

    // === Add newly uploaded files ===
    if (req.files && req.files.length > 0) {
      const newFiles = req.files.map(file => ({
        fileName: file.originalname,
        filePath: file.path, // Cloudinary URL
        uploadedAt: new Date(),
      }));
      updatedAttachments.push(...newFiles);
    }

    // === Prepare update data ===
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
      attachments: updatedAttachments, // ← Fully replaced/updated
    };

    // === Final Update ===
    const supplier = await Supplier.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

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
