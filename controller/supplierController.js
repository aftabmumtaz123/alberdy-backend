const Supplier = require('../model/Supplier');
const upload = require('../config/multer'); // Path to your multer config

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
};router.get('/api/suppliers/:id', authMiddleware, async (req, res) => {
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
});


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
    } = req.body;

    const errors = {};

    // --- Validations ---
    if (supplierName && supplierName.trim().length < 2) {
      return res.json({
        success: false,
        message: 'Supplier name must be at least 2 characters',
      })
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Valid email is required';
    } else if (email) {
      const existingEmail = await Supplier.findOne({
        email: email.trim(),
        _id: { $ne: id },
      });
      if (existingEmail) {return res.json({
        success: false,
        message: 'Email already exists',
      });}
    }


  

    // Validate address JSON
    if (address) {
      try {
        address = typeof address === 'string' ? JSON.parse(address) : address;
      } catch {
        res.status(400).json({
          success: false,
          message: 'Address must be valid JSON',
        });
      }
    }

    if (status && !['Active', 'Inactive'].includes(status)) {
     return res.json({
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
        return res.json({
        success: false,
        message: 'Supplier code already exists',
      });
    }
    }

    // --- Handle uploaded files ---
    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map(file => ({
        fileName: file.originalname,
        filePath: file.path,
        uploadedAt: new Date(),
      }));
    }

    // --- Return validation errors ---
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors occurred',
        errors,
      });
    }

    // --- Prepare update object ---
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
    };

    // --- Append new attachments (if any) ---
    if (attachments.length > 0) {
      updateData.$push = { attachments: { $each: attachments } };
    }

    // --- Update supplier ---
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
