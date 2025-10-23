const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../model/Order');
const Product = require('../model/Product');
const Variation = require('../model/variantProduct'); 
const User = require('../model/User');
const authMiddleware = require('../middleware/auth');

const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

const generateOrderNumber = async () => {
  try {
    const lastOrder = await Order.findOne().sort({ createdAt: -1 }).select('orderNumber');
    if (!lastOrder) return '#ORD-001';
    const lastNum = parseInt(lastOrder.orderNumber.replace('#ORD-', ''));
    return `#ORD-${(lastNum + 1).toString().padStart(3, '0')}`;
  } catch (err) {
    throw new Error('Failed to generate order number');
  }
};

const generateTrackingNumber = async () => {
  try {
    const lastOrder = await Order.findOne().sort({ createdAt: -1 }).select('orderTrackingNumber');
    if (!lastOrder || !lastOrder.orderTrackingNumber) return '#TRK-LEY-321-001';
    const lastNum = parseInt(lastOrder.orderTrackingNumber.replace('#TRK-LEY-321-', ''));
    return `#TRK-LEY-321-${(lastNum + 1).toString().padStart(3, '0')}`;
  } catch (err) {
    throw new Error('Failed to generate tracking number');
  }
};

router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const { items, subtotal, tax, discount, total, paymentMethod, shippingAddress, notes, shipping = 5.99 } = req.body;

    // Validate request body
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, msg: 'Order items are required' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ success: false, msg: 'Payment method is required' });
    }
    if (!shippingAddress || !shippingAddress.street || !shippingAddress.city || !shippingAddress.zip || !shippingAddress.fullName || !shippingAddress.phone) {
      return res.status(400).json({ success: false, msg: 'Complete shipping address is required' });
    }

    // Validate stock and compute totals
    const updatedItems = [];
    let computedSubtotal = 0;
    for (const item of items) {
      if (!mongoose.Types.ObjectId.isValid(item.product)) {
        return res.status(400).json({ success: false, msg: `Invalid product ID: ${item.product}` });
      }
      const product = await Product.findById(item.product).populate({
        path: 'variations',
        select: 'attribute value sku price discountPrice stockQuantity image'
      });
      if (!product) {
        return res.status(400).json({ success: false, msg: `Product not found: ${item.product}` });
      }
      if (!product.variations || !Array.isArray(product.variations)) {
        return res.status(400).json({ success: false, msg: `No variations found for product ${item.product}` });
      }

      const quantity = Number(item.quantity);
      if (isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ success: false, msg: `Invalid quantity for product ${item.product}: ${item.quantity}` });
      }

      let priceToUse, variant = null;
      if (item.variant) {
        if (!mongoose.Types.ObjectId.isValid(item.variant)) {
          return res.status(400).json({ success: false, msg: `Invalid variant ID: ${item.variant}` });
        }
        variant = product.variations.find(v => v._id.toString() === item.variant.toString());
        if (!variant) {
          return res.status(400).json({ success: false, msg: `Variant ${item.variant} not found for product ${product.name}` });
        }
        if (variant.stockQuantity < quantity) {
          return res.status(400).json({ success: false, msg: `Insufficient stock for variant ${variant.sku} in ${product.name}. Available: ${variant.stockQuantity}` });
        }
        priceToUse = variant.discountPrice || variant.price;
      } else {
        return res.status(400).json({ success: false, msg: `Variant required for product ${product.name}` });
      }

      const itemTotal = priceToUse * quantity;
      updatedItems.push({
        product: item.product,
        variant: item.variant,
        quantity,
        price: priceToUse,
        total: itemTotal
      });
      computedSubtotal += itemTotal;
    }

    // // Validate subtotal
    // if (Math.abs(computedSubtotal - subtotal) > 0.01) {
    //   return res.status(400).json({ success: false, msg: `Subtotal mismatch: provided ${subtotal}, computed ${computedSubtotal.toFixed(2)}` });
    // }

    // // Validate total
    // const calculatedTotal = subtotal + (tax || 0) + shipping - (discount || 0);
    // if (Math.abs(calculatedTotal - total) > 0.01) {
    //   return res.status(400).json({ success: false, msg: 'Total mismatch in order calculation' });
    // }

    // Generate identifiers
    const orderNumber = await generateOrderNumber();
    const trackingNumber = await generateTrackingNumber();

    // Create order
    const order = new Order({
      user: req.user.id,
      orderNumber,
      orderTrackingNumber: trackingNumber,
      items: updatedItems,
      subtotal,
      tax: tax || 0,
      discount: discount || 0,
      shipping,
      total,
      paymentMethod,
      shippingAddress,
      notes: notes || '',
      status: 'pending',
      paymentStatus: paymentMethod === 'COD' ? 'pending' : 'pending',
      trackingStatus: 'not shipped'
    });

    await order.save();

    // Update stock for variants
    for (const item of updatedItems) {
      if (item.variant) {
        await Variant.findByIdAndUpdate(item.variant, { $inc: { stockQuantity: -item.quantity } });
      }
    }

    // Populate response
    await order.populate('items.product', 'name thumbnail images');
    await order.populate({ path: 'items.variant', select: 'attribute value sku price discountPrice stockQuantity image' });
    await order.populate('user', 'name email phone');

    res.status(201).json({
      success: true,
      data: order,
      msg: `Order ${orderNumber} placed successfully`
    });
  } catch (err) {
    console.error('Order creation error:', err);
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate order number or tracking number' });
    }
    return res.status(500).json({ success: false, msg: 'Server error creating order', details: err.message || 'Unknown error' });
  }
});

router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price effectivePrice stockQuantity image')
      .populate('user', 'name email phone');
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }
    if (req.user.role === 'Customer' && order.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, msg: 'Access denied' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error fetching order', details: err.message });
  }
});

router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = status ? { status } : {};
    if (req.user.role === 'Customer') {
      query.user = req.user.id;
    }
    const orders = await Order.find(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price effectivePrice stockQuantity image')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));
    const total = await Order.countDocuments(query);
    res.json({
      success: true,
      data: orders,
      pagination: { current: parseInt(page), pages: Math.ceil(total / parseInt(limit)), total }
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error fetching orders', details: err.message });
  }
});

router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { shippingAddress, notes, paymentStatus, deliveryAssigned, deliveryDate, status, orderTrackingNumber } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });
    }
    const updateData = {};
    if (shippingAddress) updateData.shippingAddress = shippingAddress;
    if (notes) updateData.notes = notes;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (deliveryAssigned) updateData.deliveryAssigned = deliveryAssigned;
    if (deliveryDate) updateData.deliveryDate = new Date(deliveryDate);
    if (status) updateData.status = status;
    if (orderTrackingNumber) updateData.orderTrackingNumber = orderTrackingNumber;
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, msg: 'No valid fields to update' });
    }
    if (updateData.status && !['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(updateData.status)) {
      return res.status(400).json({ success: false, msg: 'Invalid status' });
    }
    if (updateData.orderTrackingNumber) {
      const existingOrder = await Order.findOne({ orderTrackingNumber: updateData.orderTrackingNumber, _id: { $ne: id } });
      if (existingOrder) {
        return res.status(400).json({ success: false, msg: 'Tracking number already in use' });
      }
    }
    const order = await Order.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price effectivePrice stockQuantity image')
      .populate('user', 'name email phone');
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }
    res.json({ success: true, data: order, msg: `Order ${order.orderNumber} updated successfully` });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error updating order', details: err.message });
  }
});

router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });
    }
    const order = await Order.findById(id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price effectivePrice stockQuantity image');
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }
    if (order.status === 'delivered' || order.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, msg: 'Cannot delete delivered or paid orders' });
    }
    for (const item of order.items) {
      if (item.variant) {
        await Variant.findByIdAndUpdate(item.variant, { $inc: { stockQuantity: item.quantity } });
      }
    }
    await Order.findByIdAndDelete(id);
    res.json({ success: true, data: order, msg: `Order ${order.orderNumber} deleted successfully` });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error deleting order', details: err.message });
  }
});

router.put('/:id/tracking', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingStatus, orderTrackingNumber } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });
    }
    const validTrackingStatuses = ['not shipped', 'shipped', 'in transit', 'out for delivery', 'delivered', 'cancelled'];
    if (trackingStatus && !validTrackingStatuses.includes(trackingStatus)) {
      return res.status(400).json({ success: false, msg: `Invalid tracking status: ${trackingStatus}` });
    }
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }
    if (trackingStatus && ['delivered', 'cancelled'].includes(order.trackingStatus)) {
      return res.status(400).json({ success: false, msg: `Cannot change tracking status from ${order.trackingStatus}` });
    }
    if (orderTrackingNumber) {
      const existingOrder = await Order.findOne({ orderTrackingNumber, _id: { $ne: id } });
      if (existingOrder) {
        return res.status(400).json({ success: false, msg: 'Tracking number already in use' });
      }
    }
    const updateData = {};
    if (trackingStatus) updateData.trackingStatus = trackingStatus;
    if (orderTrackingNumber) updateData.orderTrackingNumber = orderTrackingNumber;
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, msg: 'No valid fields to update' });
    }
    const updatedOrder = await Order.findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price effectivePrice stockQuantity image')
      .populate('user', 'name email phone');
    res.json({ success: true, data: updatedOrder, msg: `Tracking updated for order ${updatedOrder.orderNumber}` });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error updating tracking', details: err.message });
  }
});

router.get('/track/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const query = mongoose.Types.ObjectId.isValid(identifier)
      ? { _id: identifier }
      : { orderTrackingNumber: identifier };
    const order = await Order.findOne(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price effectivePrice stockQuantity image')
      .populate('user', 'name email phone');
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }
    if (req.user && req.user.role === 'Customer' && order.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, msg: 'Access denied' });
    }
    const responseData = {
      orderNumber: order.orderNumber,
      orderTrackingNumber: order.orderTrackingNumber,
      trackingStatus: order.trackingStatus,
      status: order.status,
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items
    };
    res.json({ success: true, data: responseData, msg: `Tracking details for order ${order.orderNumber}` });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Server error fetching tracking', details: err.message });
  }
});

module.exports = router;


