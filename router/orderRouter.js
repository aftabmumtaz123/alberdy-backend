const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Order = require('../model/Order');
const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const User = require('../model/User');
const AppConfiguration = require('../model/app_configuration'); // Import AppConfiguration model
const authMiddleware = require('../middleware/auth');




const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

/* ---------- Helper: generate order / tracking numbers ---------- */
const generateOrderNumber = async () => {
  const last = await Order.findOne().sort({ createdAt: -1 }).select('orderNumber');
  if (!last) return '#ORD-001';
  const num = parseInt(last.orderNumber.replace('#ORD-', '')) + 1;
  return `#ORD-${num.toString().padStart(3, '0')}`;
};

const generateTrackingNumber = async () => {
  const last = await Order.findOne().sort({ createdAt: -1 }).select('orderTrackingNumber');
  if (!last || !last.orderTrackingNumber) return '#TRK-LEY-321-001';
  const num = parseInt(last.orderTrackingNumber.replace('#TRK-LEY-321-', '')) + 1;
  return `#TRK-LEY-321-${num.toString().padStart(3, '0')}`;
};

/* ---------- Helper: fetch currency settings ---------- */
const getCurrencySettings = async () => {
  try {
    const config = await AppConfiguration.findOne().lean().select('currencyName currencyCode currencySign');
    if (!config) {
      // Fallback if no configuration is found
      return {
        currencyName: 'US Dollar',
        currencyCode: 'USD',
        currencySign: '$',
      };
    }
    return {
      currencyName: config.currencyName,
      currencyCode: config.currencyCode,
      currencySign: config.currencySign,
    };
  } catch (err) {
    console.error('Error fetching currency settings:', err);
    // Fallback on error
    return {
      currencyName: 'US Dollar',
      currencyCode: 'USD',
      currencySign: '$',
    };
  }
};



/* -------------------------- CREATE ORDER -------------------------- */
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const {
      items, subtotal, tax = 0, discount = 0, total,
      paymentMethod, shippingAddress, notes, shipping = 5.99
    } = req.body;

    // ---- basic validation ----
    if (!items?.length) return res.status(400).json({ success: false, msg: 'Order items required' });
    if (!paymentMethod) return res.status(400).json({ success: false, msg: 'Payment method required' });
    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.zip ||
        !shippingAddress?.fullName || !shippingAddress?.phone || !shippingAddress?.email) {
      return res.status(400).json({ success: false, msg: 'Complete shipping address and email required' });
    }

    // ---- compute subtotal & validate stock ----
    const orderItems = [];
    let computedSubtotal = 0;

    for (const itm of items) {
      if (!mongoose.Types.ObjectId.isValid(itm.product))
        return res.status(400).json({ success: false, msg: `Invalid product ID: ${itm.product}` });

      const product = await Product.findById(itm.product)
        .populate({ path: 'variations', select: 'attribute value sku price discountPrice stockQuantity image' });

      if (!product) return res.status(400).json({ success: false, msg: `Product not found: ${itm.product}` });
      if (!product.variations?.length)
        return res.status(400).json({ success: false, msg: `No variations for product ${product.name}` });

      const qty = Number(itm.quantity);
      if (isNaN(qty) || qty <= 0)
        return res.status(400).json({ success: false, msg: `Invalid quantity for ${product.name}` });

      if (!itm.variant)
        return res.status(400).json({ success: false, msg: `Variant required for ${product.name}` });

      if (!mongoose.Types.ObjectId.isValid(itm.variant))
        return res.status(400).json({ success: false, msg: `Invalid variant ID: ${itm.variant}` });

      const variant = product.variations.find(v => v._id.toString() === itm.variant);
      if (!variant) return res.status(400).json({ success: false, msg: `Variant not found` });

      if (variant.stockQuantity < qty)
        return res.status(400).json({ success: false, msg: `Insufficient stock for ${product.name} (${variant.attribute}: ${variant.value})` });

      const price = variant.discountPrice || variant.price;
      const lineTotal = price * qty;

      orderItems.push({
        product: itm.product,
        variant: itm.variant,
        quantity: qty,
        price,
        total: lineTotal
      });
      computedSubtotal += lineTotal;
    }

    // ---- subtotal / total validation ----
    if (Math.abs(computedSubtotal - subtotal) > 0.01)
      return res.status(400).json({
        success: false,
        msg: `Subtotal mismatch: provided ${subtotal}, computed ${computedSubtotal.toFixed(2)}`
      });

    const calcTotal = subtotal + tax + shipping - discount;
    if (Math.abs(calcTotal - total) > 0.01)
      return res.status(400).json({ success: false, msg: 'Total amount mismatch' });

    // ---- generate numbers & create order ----
    const orderNumber = await generateOrderNumber();
    const trackingNumber = await generateTrackingNumber();

    const order = new Order({
      user: req.user.id,
      orderNumber,
      orderTrackingNumber: trackingNumber,
      items: orderItems,
      subtotal,
      tax,
      discount,
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

    // ---- decrement stock ----
    for (const itm of orderItems) {
      await Variant.findByIdAndUpdate(itm.variant, { $inc: { stockQuantity: -itm.quantity } });
    }

    // ---- populate response ----
    await order.populate('items.product', 'name thumbnail images');
    await order.populate({
      path: 'items.variant',
      select: 'attribute value sku price discountPrice stockQuantity image'
    });
    await order.populate('user', 'name email phone');

    // ——————————————————————
    // SEND PUSH NOTIFICATIONS (NOW SAFE!)
    // ——————————————————————
    try {
      const PushSubscription = require('../model/PushSubscription');
      const { sendNotification } = require('../utils/sendPushNotification');

      const adminSubs = await PushSubscription.find({
        role: { $in: ['Super Admin', 'Manager'] }
      }).select('endpoint keys');

      if (adminSubs.length > 0) {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${total.toFixed(2)}`;

        const notificationPromises = adminSubs.map(sub =>
          sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys
            },
            'New Order Received!',
            `${orderNumber} • ${totalFormatted} • ${paymentMethod.toUpperCase()}`,
            {
              orderId: order._id.toString(),
              url: `/admin/orders/${order._id}`
            }
          ).catch(err => console.warn('Failed to send push to one subscriber:', err.message))
        );

        // Fire and forget (non-blocking)
        Promise.allSettled(notificationPromises);
      }
    } catch (pushErr) {
      console.error('Push notification error (non-critical):', pushErr);
      // Don't fail the order just because push failed
    }

    // ——————————————————————

    res.status(201).json({
      success: true,
      data: order,
      msg: `Order ${orderNumber} placed successfully`
    });

  } catch (err) {
    console.error('Order creation error:', err);
    if (err.name === 'MongoServerError' && err.code === 11000)
      return res.status(400).json({ success: false, msg: 'Duplicate order/tracking number' });

    res.status(500).json({
      success: false,
      msg: 'Server error creating order',
      details: err.message
    });
  }
});




/* -------------------------- GET ONE ORDER -------------------------- */
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    // Fetch currency settings
    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        order,
        currency, // Include currency details
      },
    });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- LIST ORDERS -------------------------- */
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const { page = 1, limit, status } = req.query;
    const query = status ? { status } : {};
    if (req.user.role === 'Customer') query.user = req.user.id;

    const orders = await Order.find(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice effectivePrice total stockQuantity image product')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    // Fetch currency settings
    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        orders,
        currency, // Include currency details
      },
      pagination: { current: +page, pages: Math.ceil(total / limit), total },
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- UPDATE ORDER -------------------------- */
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { shippingAddress, notes, paymentStatus, status, orderTrackingNumber, deliveryDate, deliveryPartner } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const order = await Order.findById(id).populate('items.variant');
    if (!order)
      return res.status(404).json({ success: false, msg: 'Order not found' });

    const update = {};

    // 1️⃣ Update allowed fields
    if (shippingAddress) update.shippingAddress = shippingAddress;
    if (notes) update.notes = notes;
    if (deliveryDate) update.deliveryDate = deliveryDate;
    if (deliveryPartner) update.deliveryPartner = deliveryPartner;
    if (orderTrackingNumber) update.orderTrackingNumber = orderTrackingNumber;

    // 2️⃣ Handle Order Status Logic
    if (status) {
      const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
      if (!validStatuses.includes(status))
        return res.status(400).json({ success: false, msg: `Invalid status: ${status}` });

      update.status = status;

      // Business Logic:
      if (status === 'confirmed' && order.paymentMethod === 'COD') {
        update.paymentStatus = 'unpaid'; // COD confirmation allowed without payment
      } else if (status === 'delivered') {
        update.paymentStatus = 'paid'; // Payment considered received after delivery
      } else if (status === 'cancelled') {
        update.paymentStatus = 'unpaid'; // Cancelled orders always unpaid
      }
    }

    // 3️⃣ Restrict manual paymentStatus override unless valid
    if (paymentStatus) {
      if (paymentStatus === 'paid' && order.status !== 'delivered') {
        return res.status(400).json({
          success: false,
          msg: 'COD payment can only be marked after delivery.'
        });
      }
      if (order.status === 'cancelled' && paymentStatus === 'paid') {
        return res.status(400).json({
          success: false,
          msg: 'Cancelled orders cannot have payment marked as paid'
        });
      }
      update.paymentStatus = paymentStatus;
    }

    // 4️⃣ Restore stock for cancelled orders
    if (status === 'cancelled') {
      for (const item of order.items) {
        if (item.variant && mongoose.Types.ObjectId.isValid(item.variant._id)) {
          await Variant.findByIdAndUpdate(
            item.variant._id,
            { $inc: { stockQuantity: item.quantity } },
            { runValidators: true }
          );
        }
      }
    }

    // 5️⃣ Save update
    const updatedOrder = await Order.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    res.json({
      success: true,
      data: updatedOrder,
      msg: `Order ${updatedOrder.orderNumber} updated successfully`
    });
  } catch (err) {
    console.error('Order update error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- DELETE ORDER (restore stock) -------------------------- */
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const order = await Order.findById(id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });
    if (order.status === 'delivered' || order.paymentStatus === 'paid')
      return res.status(400).json({ success: false, msg: 'Cannot delete delivered/paid orders' });

    if (order.status === 'pending') {
      for (const item of order.items) {
        if (item.variant) {
          await Variant.findByIdAndUpdate(item.variant, { $inc: { stockQuantity: item.quantity } });
        }
      }
      await Order.findByIdAndDelete(id);
      res.json({ success: true, data: order, msg: `Order ${order.orderNumber} deleted successfully` });
    } else {
      return res.status(400).json({ success: false, msg: 'Only pending orders can be deleted' });
    }
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- UPDATE TRACKING -------------------------- */
router.put('/:id/tracking', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingStatus, orderTrackingNumber } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const valid = ['not shipped', 'shipped', 'in transit', 'out for delivery', 'delivered', 'cancelled'];
    if (trackingStatus && !valid.includes(trackingStatus))
      return res.status(400).json({ success: false, msg: `Invalid tracking status: ${trackingStatus}` });

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (trackingStatus && ['delivered', 'cancelled'].includes(order.trackingStatus))
      return res.status(400).json({
        success: false,
        msg: `Cannot change tracking from ${order.trackingStatus}`
      });

    if (orderTrackingNumber) {
      const exists = await Order.findOne({ orderTrackingNumber, _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, msg: 'Tracking number already used' });
    }

    const upd = {};
    if (trackingStatus) upd.trackingStatus = trackingStatus;
    if (orderTrackingNumber) upd.orderTrackingNumber = orderTrackingNumber;
    if (!Object.keys(upd).length) return res.status(400).json({ success: false, msg: 'Nothing to update' });

    const updated = await Order.findByIdAndUpdate(id, { $set: upd }, { new: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    res.json({ success: true, data: updated, msg: `Tracking updated for ${updated.orderNumber}` });
  } catch (err) {
    console.error('Error updating tracking:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- PUBLIC TRACKING LOOKUP -------------------------- */
router.get('/track/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const query = mongoose.Types.ObjectId.isValid(identifier)
      ? { _id: identifier }
      : { orderTrackingNumber: identifier };

    const order = await Order.findOne(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (req.user?.role === 'Customer' && order.user.toString() !== req.user.id)
      return res.status(403).json({ success: false, msg: 'Access denied' });

    const slim = {
      orderNumber: order.orderNumber,
      orderTrackingNumber: order.orderTrackingNumber,
      trackingStatus: order.trackingStatus,
      status: order.status,
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items
    };

    // Fetch currency settings
    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        order: slim,
        currency, // Include currency details
      },
      msg: `Tracking for ${order.orderNumber}`
    });
  } catch (err) {
    console.error('Error tracking order:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

module.exports = router;