const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const { createNotification } = require('../utils/createNotification');

const Order = require('../model/Order');
const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const User = require('../model/User');
const AppConfiguration = require('../model/app_configuration');
const SmtpConfig = require('../model/SmtpConfig');
const EmailTemplate = require('../model/EmailTemplate');
const authMiddleware = require('../middleware/auth');

const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// ────────────────────────────────────────────────
// Generators
// ────────────────────────────────────────────────

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

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

const getCurrencySettings = async () => {
  try {
    const config = await AppConfiguration.findOne().lean().select('currencyName currencyCode currencySign');
    return config || {
      currencyName: 'US Dollar',
      currencyCode: 'USD',
      currencySign: '$',
    };
  } catch (err) {
    console.error('Error fetching currency settings:', err);
    return { currencyName: 'US Dollar', currencyCode: 'USD', currencySign: '$' };
  }
};

const getActiveSmtpConfig = async () => {
  try {
    return await SmtpConfig.findOne({ status: 'active' }).lean() || null;
  } catch (err) {
    console.error('Error fetching SMTP config:', err);
    return null;
  }
};

const getEmailTemplate = async (type) => {
  try {
    return await EmailTemplate.findOne({ type, status: 'active' }).lean() || null;
  } catch (err) {
    console.error(`Error fetching template for ${type}:`, err);
    return null;
  }
};

const renderTemplate = (content, variables) => {
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return rendered;
};

const createTransporter = (smtpConfig) => {
  if (!smtpConfig) return null;
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.encryption === 'SSL/TLS',
    auth: {
      user: smtpConfig.username,
      pass: smtpConfig.password,
    },
  });
};

const sendEmail = async (to, templateType, variables = {}) => {
  const smtp = await getActiveSmtpConfig();
  if (!smtp) return;

  const template = await getEmailTemplate(templateType);
  if (!template) return;

  const transporter = createTransporter(smtp);
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from: `${template.fromName} <${template.fromEmail}>`,
      to,
      subject: renderTemplate(template.subject, variables),
      html: renderTemplate(template.content, variables),
    });
    console.log(`Email sent to ${to} [${templateType}]`);
  } catch (err) {
    console.error(`Email failed [${templateType}]:`, err);
  }
};

/**
 * Improved low-stock check:
 * - Uses availableStock (stock - reserved)
 * - Batch fetches products to avoid N+1
 * - Sends notification per low variant
 */
const checkAndSendLowStockAlerts = async (variants, adminEmail) => {
  // Use available stock (recommended)
  const lowStockVariants = variants.filter(v => {
    const reserved = v.reservedQuantity || 0;
    return (v.stockQuantity - reserved) < 5;
  });

  if (lowStockVariants.length === 0) return;

  // Get unique product IDs
  const productIds = [...new Set(lowStockVariants.map(v => v.product))];

  // Batch fetch products
  const products = await Product.find({ _id: { $in: productIds } })
    .select('name')
    .lean();

  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  // Enrich variants with product data
  const enriched = lowStockVariants.map(v => ({
    ...v,
    product: productMap.get(v.product.toString()) || { name: 'Unknown Product' }
  }));

  // Email (combined list)
  const lowStockItems = enriched
    .map(v => `${v.product.name} - ${v.attribute}: ${v.value} (Stock: ${v.stockQuantity})`)
    .join('<br>');

  if (adminEmail) {
    await sendEmail(adminEmail, 'low_stock_alert', { lowStockItems });
  }

  // In-app notifications for all admins/managers
  const admins = await User.find({ role: { $in: ['Super Admin', 'Manager'] } })
    .select('_id')
    .lean();

  for (const v of enriched) {
    const msg = `${v.product.name} (${v.attribute}: ${v.value}) → only ${v.stockQuantity} left`;

    for (const admin of admins) {
      await createNotification({
        userId: admin._id,
        type: 'low_stock_alert',
        title: 'Low Stock Alert',
        message: msg,
        related: { productId: v.product._id?.toString() }
      }).catch(err => console.error('Low stock notification failed:', err));
    }
  }
};

// ────────────────────────────────────────────────
// POST /orders - Create order
// ────────────────────────────────────────────────

router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const {
      items, subtotal, tax = 0, discount = 0, total,
      paymentMethod, shippingAddress, notes, shipping = 5.99,
      paymentProvider, isPaymentVerified, paymentId, paymentResponse,
      paymentStatus
    } = req.body;

    if (!items?.length) return res.status(400).json({ success: false, msg: 'Order items required' });
    if (!paymentMethod) return res.status(400).json({ success: false, msg: 'Payment method required' });

    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.zip ||
        !shippingAddress?.fullName || !shippingAddress?.phone || !shippingAddress?.email) {
      return res.status(400).json({ success: false, msg: 'Complete shipping address and email required' });
    }

    const orderItems = [];
    let computedSubtotal = 0;
    const variantsToCheck = [];

    for (const itm of items) {
      if (!mongoose.Types.ObjectId.isValid(itm.product))
        return res.status(400).json({ success: false, msg: `Invalid product ID: ${itm.product}` });

      const product = await Product.findById(itm.product)
        .populate({ path: 'variations', select: 'attribute value sku price discountPrice stockQuantity image product reservedQuantity' });

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

      const price = variant.discountPrice ?? variant.price;
      const lineTotal = price * qty;

      orderItems.push({
        product: itm.product,
        variant: itm.variant,
        quantity: qty,
        price,
        total: lineTotal
      });

      computedSubtotal += lineTotal;
      variantsToCheck.push(variant);
    }

    const calcTotal = subtotal + tax + shipping - discount;
    if (Math.abs(calcTotal - total) > 0.001)
      return res.status(400).json({ success: false, msg: 'Total amount mismatch' });

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
      paymentProvider: paymentProvider || null,
      paymentId: paymentId || null,
      paymentResponse: paymentResponse || null,
      isPaymentVerified: isPaymentVerified || false,
      paymentStatus: paymentStatus || null,
      status: 'pending',
      trackingStatus: 'not shipped',
      shippingAddress,
      notes: notes || ''
    });

    await order.save();

    await order.populate('items.product', 'name thumbnail images');
    await order.populate({
      path: 'items.variant',
      select: 'attribute value sku price discountPrice stockQuantity image'
    });
    await order.populate('user', 'name email phone');

    // Web Push (unchanged)
    try {
      const PushSubscription = require('../model/PushSubscription');
      const { sendNotification } = require('../utils/sendPushNotification');

      const adminSubs = await PushSubscription.find({
        role: { $in: ['Super Admin', 'Manager'] }
      }).select('endpoint keys');

      if (adminSubs.length > 0) {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${total.toFixed(2)}`;

        await Promise.allSettled(
          adminSubs.map(sub =>
            sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys },
              'New Order Received!',
              `${orderNumber} • ${totalFormatted} • ${paymentMethod.toUpperCase()}`,
              { orderId: order._id.toString(), url: `/admin/orders/${order._id}` }
            ).catch(err => console.warn('Push failed for one sub:', err.message))
          )
        );
      }
    } catch (pushErr) {
      console.error('Push notification error (non-critical):', pushErr);
    }

    // Email + In-app notifications
    try {
      const currency = await getCurrencySettings();
      const totalFormatted = `${currency.currencySign}${total.toFixed(2)}`;

      // Customer email
      const customerVars = {
        user_name: order.user.name,
        order_number: order.orderNumber,
        order_trackingNumber: order.orderTrackingNumber,
        order_total: totalFormatted,
        order_status: order.status,
        order_paymentMethod: order.paymentMethod,
        shippingAddress: `${order.shippingAddress.fullName}, ${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.zip}`,
      };
      await sendEmail(order.user.email, 'order_placed', customerVars);

      // Admins
      const admins = await User.find({ role: { $in: ['Super Admin', 'Manager'] } })
        .select('_id email name')
        .lean();

      for (const admin of admins) {
        // Admin email
        if (admin.email) {
          const adminVars = {
            order_number: order.orderNumber,
            order_total: totalFormatted,
            customer_name: order.user.name,
            customer_email: order.user.email,
            order_paymentMethod: paymentMethod,
          };
          await sendEmail(admin.email, 'order_placed', adminVars);
        }

        // In-app notification
        await createNotification({
          userId: admin._id,
          type: 'order_placed',
          title: 'New Order Received',
          message: `Order ${orderNumber} • ${totalFormatted} • ${paymentMethod.toUpperCase()}`,
          related: { orderId: order._id.toString() }
        }).catch(err => console.error('Order placed notification failed:', err));
      }

      // Low stock check
      if (variantsToCheck.length > 0) {
        await checkAndSendLowStockAlerts(variantsToCheck, admins[0]?.email || null);
      }
    } catch (err) {
      console.error('Email/notification error (non-critical):', err);
    }

    res.status(201).json({
      success: true,
      data: order,
      msg: `Order ${orderNumber} placed successfully`
    });
  } catch (err) {
    console.error('Order creation error:', err);
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate order/tracking number' });
    }
    res.status(500).json({
      success: false,
      msg: 'Server error creating order',
      error: err.message
    });
  }
});

// ────────────────────────────────────────────────
// Other routes (GET one, list, update, delete, tracking, public track, subscribe, refund, verify-payment)
// ────────────────────────────────────────────────
// (kept mostly unchanged, but added status change & payment verification notifications)

router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    const currency = await getCurrencySettings();

    res.json({ success: true, data: { order, currency } });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ success: false, msg: 'Server error', error: err.message });
  }
});

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
      .skip((page - 1) * Number(limit))
      .limit(Number(limit));

    const total = await Order.countDocuments(query);
    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: { orders, currency },
      pagination: { current: Number(page), pages: Math.ceil(total / limit), total }
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, msg: 'Server error', error: err.message });
  }
});

router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { shippingAddress, notes, paymentStatus, status, orderTrackingNumber, deliveryDate, deliveryPartner } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const order = await Order.findById(id).populate('items.variant user');
    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    const oldStatus = order.status;

    const update = {};

    if (shippingAddress) update.shippingAddress = shippingAddress;
    if (notes) update.notes = notes;
    if (deliveryDate) update.deliveryDate = deliveryDate;
    if (deliveryPartner) update.deliveryPartner = deliveryPartner;
    if (orderTrackingNumber) update.orderTrackingNumber = orderTrackingNumber;

    if (status) {
      const valid = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
      if (!valid.includes(status))
        return res.status(400).json({ success: false, msg: `Invalid status: ${status}` });

      update.status = status;

      if (status === 'confirmed' && order.paymentMethod === 'COD') {
        update.paymentStatus = 'unpaid';
      } else if (status === 'delivered') {
        update.paymentStatus = 'paid';
      } else if (status === 'cancelled') {
        update.paymentStatus = 'unpaid';
      }
    }

    if (paymentStatus) {
      if (paymentStatus === 'paid' && order.status !== 'delivered') {
        return res.status(400).json({ success: false, msg: 'COD payment can only be marked after delivery.' });
      }
      if (order.status === 'cancelled' && paymentStatus === 'paid') {
        return res.status(400).json({ success: false, msg: 'Cancelled orders cannot have payment marked as paid' });
      }
      update.paymentStatus = paymentStatus;
    }

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

    const updatedOrder = await Order.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    // Status change notification + email
    if (status && status !== oldStatus) {
      try {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${updatedOrder.total.toFixed(2)}`;

        const admins = await User.find({ role: { $in: ['Super Admin', 'Manager'] } })
          .select('_id')
          .lean();

        for (const admin of admins) {
          await createNotification({
            userId: admin._id,
            type: 'order_status_updated',
            title: 'Order Status Updated',
            message: `Order ${updatedOrder.orderNumber} → ${updatedOrder.status} (was ${oldStatus})`,
            related: { orderId: updatedOrder._id.toString() }
          });
        }

        const variables = {
          user_name: updatedOrder.user.name,
          order_number: updatedOrder.orderNumber,
          order_status: updatedOrder.status,
          order_oldStatus: oldStatus,
          order_total: totalFormatted,
          order_trackingNumber: updatedOrder.orderTrackingNumber,
        };
        await sendEmail(updatedOrder.user.email, 'order_status_updated', variables);
      } catch (err) {
        console.error('Status update notification/email error:', err);
      }
    }

    res.json({
      success: true,
      data: updatedOrder,
      msg: `Order ${updatedOrder.orderNumber} updated successfully`
    });
  } catch (err) {
    console.error('Order update error:', err);
    res.status(500).json({ success: false, msg: 'Server error', error: err.message });
  }
});

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
    res.status(500).json({ success: false, msg: 'Server error', error: err.message });
  }
});

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
      return res.status(400).json({ success: false, msg: `Cannot change tracking from ${order.trackingStatus}` });

    if (orderTrackingNumber) {
      const exists = await Order.findOne({ orderTrackingNumber, _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, msg: 'Tracking number already used' });
    }

    const upd = {};
    if (trackingStatus) upd.trackingStatus = trackingStatus;
    if (orderTrackingNumber) upd.orderTrackingNumber = orderTrackingNumber;

    if (!Object.keys(upd).length)
      return res.status(400).json({ success: false, msg: 'Nothing to update' });

    const updated = await Order.findByIdAndUpdate(id, { $set: upd }, { new: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    res.json({ success: true, data: updated, msg: `Tracking updated for ${updated.orderNumber}` });
  } catch (err) {
    console.error('Error updating tracking:', err);
    res.status(500).json({ success: false, msg: 'Server error', error: err.message });
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

    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: { order: slim, currency },
      msg: `Tracking for ${order.orderNumber}`
    });
  } catch (err) {
    console.error('Error tracking order:', err);
    res.status(500).json({ success: false, msg: 'Server error', error: err.message });
  }
});

router.post('/subscribe', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  const { subscription } = req.body;
  const PushSubscription = require('../model/PushSubscription');

  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: req.user.id,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      role: req.user.role
    },
    { upsert: true, new: true }
  );

  res.json({ success: true, msg: 'Subscribed to notifications' });
});

router.get('/key/public-key', (req, res) => {
  res.json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

router.post('/:orderId/refund-request', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.orderId);

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (order.user.toString() !== req.user.id && !['Super Admin', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, msg: 'Not allowed' });
    }

    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ success: false, msg: 'Only paid orders can be refunded' });
    }

    if (order.status === 'returned' || order.paymentStatus === 'refunded') {
      return res.status(400).json({ success: false, msg: 'Refund already requested or processed' });
    }

    order.status = 'returned';
    order.paymentStatus = 'refunded';
    order.refundReason = reason || 'No reason provided';
    order.refundRequestedAt = new Date();

    await order.save();

    res.json({ success: true, msg: 'Refund request submitted successfully', order });
  } catch (err) {
    console.error('Refund request error:', err);
    res.status(500).json({ success: false, msg: 'Refund request failed', error: err.message });
  }
});

router.post('/verify-payment', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { orderId, isPaymentVerified, reason } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, msg: 'Valid orderId is required' });
    }

    if (typeof isPaymentVerified !== 'boolean') {
      return res.status(400).json({ success: false, msg: 'isPaymentVerified must be boolean' });
    }

    const order = await Order.findById(orderId)
      .populate('items.product', 'name')
      .populate('user', 'name email');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (order.status === 'cancelled') {
      return res.status(400).json({ success: false, msg: 'Cannot modify payment status of cancelled orders' });
    }

    const previousPaymentStatus = order.paymentStatus;
    const previousIsVerified = order.isPaymentVerified;

    if (isPaymentVerified) {
      if (order.isPaymentVerified) {
        return res.status(400).json({ success: false, msg: 'Payment is already verified' });
      }
      if (order.status === 'returned') {
        return res.status(400).json({ success: false, msg: 'Cannot verify payment for returned orders' });
      }

      order.isPaymentVerified = true;
      order.paymentStatus = 'paid';
      order.paymentVerifiedAt = new Date();
      order.paymentVerifiedBy = req.user.id;

      if (order.status === 'pending') {
        order.status = 'confirmed';
      }

      // ── NEW: Payment confirmation notification ────────
      const admins = await User.find({ role: { $in: ['Super Admin', 'Manager'] } })
        .select('_id')
        .lean();

      const currency = await getCurrencySettings();
      const totalFormatted = `${currency.currencySign}${order.total.toFixed(2)}`;

      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          type: 'payment_confirmation',
          title: 'Payment Confirmed',
          message: `Order ${order.orderNumber} - ${totalFormatted} payment verified`,
          related: { orderId: order._id.toString() }
        }).catch(err => console.error('Payment confirmation notification failed:', err));
      }
    } else {
      if (order.paymentStatus === 'refunded') {
        return res.status(400).json({ success: false, msg: 'Cannot unverify refunded orders' });
      }

      order.isPaymentVerified = false;
      order.paymentStatus = 'unpaid';
      order.paymentVerifiedAt = null;
      order.paymentVerifiedBy = null;
    }

    if (!order.paymentHistory) order.paymentHistory = [];
    order.paymentHistory.push({
      action: isPaymentVerified ? 'mark-paid' : 'mark-unpaid',
      previousStatus: previousPaymentStatus,
      newStatus: order.paymentStatus,
      previousVerified: previousIsVerified,
      newVerified: order.isPaymentVerified,
      reason: reason || 'No reason provided',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      timestamp: new Date()
    });

    await order.save();

    // Payment confirmation email
    if (isPaymentVerified) {
      try {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${order.total.toFixed(2)}`;
        const variables = {
          user_name: order.user.name,
          order_number: order.orderNumber,
          order_total: totalFormatted,
          order_status: order.status,
          order_paymentMethod: order.paymentMethod,
        };
        await sendEmail(order.user.email, 'payment_confirmation', variables);
      } catch (err) {
        console.error('Payment confirmation email error:', err);
      }
    }

    res.json({
      success: true,
      msg: `Payment verification ${isPaymentVerified ? 'enabled' : 'disabled'}`,
      data: {
        orderNumber: order.orderNumber,
        previousStatus: previousPaymentStatus,
        newStatus: order.paymentStatus,
        previousVerified: previousIsVerified,
        newVerified: order.isPaymentVerified,
        updatedBy: req.user.name || req.user.email
      }
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({
      success: false,
      msg: 'Server error during payment verification',
      error: err.message
    });
  }
});

module.exports = router;