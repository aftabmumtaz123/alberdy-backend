// controllers/customerController.js
const Customer = require('../model/Customer');
const Order = require('../model/Order'); // Assuming Order model exists with customer: { type: Schema.Types.ObjectId, ref: 'Customer' }
const mongoose = require('mongoose');

// Create Customer
exports.createCustomer = async (req, res) => {
  const { name, email, phone, street, city, state, zip, country, petType, status = 'Active' } = req.body;


  if (!['Dog', 'Cat', 'Bird', 'Fish', 'Multiple'].includes(petType)) {
    return res.status(400).json({ success: false, msg: 'Invalid petType' });
  }
  if (!['Active', 'Blocked'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  try {
    // Check unique email
    const existingCustomer = await Customer.findOne({ email });
    if (existingCustomer) {
      return res.status(400).json({ success: false, msg: 'Customer with this email already exists' });
    }

    const now = new Date().toISOString();
    const customerData = {
      name,
      email,
      phone,
      address: {
        street,
        city,
        state,
        zip,
        country: country || 'USA' // Default to USA if not provided
      },
      petType,
      status,
      createdAt: now,
      updatedAt: now
    };

    const newCustomer = new Customer(customerData);
    await newCustomer.save();

    res.status(201).json({
      success: true,
      msg: 'Customer created successfully',
      customer: newCustomer
    });
  } catch (err) {
    console.error('Customer creation error:', err);
    if (err.code === 11000) { // Duplicate key
      return res.status(400).json({ success: false, msg: 'Email already in use' });
    }
    res.status(500).json({ success: false, msg: 'Server error during customer creation' });
  }
};

// Get All Customers (List View with Orders Count)
exports.getAllCustomers = async (req, res) => {
  const { page = 1, limit , status, petType, name, email } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (petType) filter.petType = petType;
  if (name) filter.name = { $regex: name, $options: 'i' };
  if (email) filter.email = { $regex: email, $options: 'i' };

  try {
    const customers = await Customer.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'orders', 
          localField: '_id',
          foreignField: 'customer', 
          as: 'orders'
        }
      },
      {
        $addFields: {
          ordersCount: { $size: '$orders' }
        }
      },
      {
        $project: {
          orders: 0 // Exclude full orders array
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: (parseInt(page) - 1) * parseInt(limit) },
            { $limit: parseInt(limit) }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ]);

    const total = customers[0]?.total[0]?.count || 0;
    const customerList = customers[0]?.data || [];

    res.json({
      success: true,
      customers: customerList,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    console.error('Customer list error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching customers' });
  }
};

// Get Customer by ID
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, msg: 'Customer not found' });
    }

    // Add orders count
    const ordersCount = await Order.countDocuments({ customer: customer._id });

    const response = {
      ...customer.toObject(),
      ordersCount
    };

    res.json({ success: true, customer: response });
  } catch (err) {
    console.error('Customer get error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching customer' });
  }
};

// Update Customer
exports.updateCustomer = async (req, res) => {
  const { name, email, phone, street, city, state, zip, country, petType, status } = req.body;

  // Validation (optional fields)
  if (petType !== undefined && !['Dog', 'Cat', 'Bird', 'Fish', 'Multiple'].includes(petType)) {
    return res.status(400).json({ success: false, msg: 'Invalid petType' });
  }
  if (status !== undefined && !['Active', 'Blocked'].includes(status)) {
    return res.status(400).json({ success: false, msg: 'Invalid status' });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid customer ID format' });
    }

    const currentCustomer = await Customer.findById(req.params.id);
    if (!currentCustomer) {
      return res.status(404).json({ success: false, msg: 'Customer not found' });
    }

    // Check unique email if changing
    if (email !== undefined && email !== currentCustomer.email) {
      const existing = await Customer.findOne({ email });
      if (existing) {
        return res.status(400).json({ success: false, msg: 'Email already in use' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (petType !== undefined) updateData.petType = petType;
    if (status !== undefined) updateData.status = status;

    // Handle address updates
    const addressUpdate = {};
    if (street !== undefined) addressUpdate.street = street;
    if (city !== undefined) addressUpdate.city = city;
    if (state !== undefined) addressUpdate.state = state;
    if (zip !== undefined) addressUpdate.zip = zip;
    if (country !== undefined) addressUpdate.country = country;

    if (Object.keys(addressUpdate).length > 0) {
      updateData.address = {
        ...currentCustomer.address.toObject(),
        ...addressUpdate
      };
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, msg: 'No fields provided to update' });
    }

    updateData.updatedAt = new Date().toISOString();

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    // Add orders count to response
    const ordersCount = await Order.countDocuments({ customer: customer._id });

    const response = {
      ...customer.toObject(),
      ordersCount
    };

    res.json({
      success: true,
      msg: 'Customer updated successfully',
      customer: response
    });
  } catch (err) {
    console.error('Customer update error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Email already in use' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, msg: `Validation error: ${err.message}` });
    }
    res.status(500).json({ success: false, msg: 'Server error updating customer' });
  }
};

// Delete Customer (Hard delete; consider soft via status='Blocked' if preferred)
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, msg: 'Customer not found' });
    }

    await Customer.findByIdAndDelete(req.params.id);

    res.json({ success: true, msg: 'Customer deleted successfully' });
  } catch (err) {
    console.error('Customer delete error:', err);
    res.status(500).json({ success: false, msg: 'Server error deleting customer' });
  }
};