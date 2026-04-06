# RoadRush Logistics API Documentation

This document provides details for the RoadRush Logistics integration APIs.

## Authentication

### Login
Authenticate with the service to receive a bearer token.

```bash
curl -X POST https://www.roadrush.xyz/api/customer/login/ \
 -H "Content-Type: application/json" \
 -d '{"username":"YOUR_USERNAME", "password":"YOUR_PASSWORD"}'
```

---

## sender-address Management

### Get Sender Address
Retrieve the sender addresses associated with your account.

```bash
curl -X GET https://www.roadrush.xyz/api/customer/sender-address/ \
 -H "Authorization: Bearer YOUR_TOKEN"
```

### Add New Pickup Address
Add a new pickup location to your account.

```bash
curl -X POST https://www.roadrush.xyz/api/customer/add-pickup-address/ \
 -H "Authorization: Bearer YOUR_TOKEN" \
 -H "Content-Type: application/json" \
 -d '{ 
   "sender_name": "New API Store", 
   "sender_address": "Test Street 123", 
   "division": "Dhaka", 
   "district": "Dhaka", 
   "thana": "Gulshan", 
   "sender_phone": "01711223344", 
   "sender_latitude": "23.7925", 
   "sender_longitude": "90.4078" 
 }'
```

---

## Logistics & Shipping

### Get Aggregator List
Retrieve a list of available delivery aggregators.

```bash
curl --location 'https://www.roadrush.xyz/api/customer/aggregators/' \
 --header 'Authorization: Bearer YOUR_TOKEN' \
 --data ''
```

### Request a Rider (Place Order)
Place a new delivery request.

```bash
curl -X POST https://www.roadrush.xyz/api/customer/place-order/ \
 -H "Authorization: Bearer YOUR_TOKEN" \
 -H "Content-Type: application/json" \
 -d '{
   "marcent_pickup_address_id": 1,
   "aggregator": "pathao",
   "receiver_division": "Dhaka",
   "receiver_district": "Dhaka",
   "receiver_thana": "Dhanmondi",
   "drop_address": "House 10, Road 5, Dhanmondi",
   "customer_full_name": "Buyer X",
   "customer_mobile_number": "01900000000",
   "item_value": 500,
   "cod": true,
   "item_details": "T-shirt"
 }'
```

---

## Order Management

### Get All Orders
Retrieve your order history.

```bash
curl -X GET https://www.roadrush.xyz/api/customer/order-history/ \
 -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Order Details
Retrieve detailed information for a specific order using its code.

```bash
curl --location 'https://www.roadrush.xyz/api/customer/order_details/' \
 --header 'Authorization: Bearer YOUR_TOKEN' \
 --header 'Content-Type: application/json' \
 --data '{
   "order_code": "ORDER_CODE"
 }'
```

---

## Locations & Geography

### Get Divisions
List all available divisions.

```bash
curl -X GET https://www.roadrush.xyz/api/customer/divisions/ \
 -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Districts
List districts for a specific division.

```bash
curl -X GET 'https://www.roadrush.xyz/api/customer/districts/?division_id=1' \
 -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Thanas
List thanas for a specific district.

```bash
curl -X GET 'https://www.roadrush.xyz/api/customer/thanas/?district_id=1' \
 -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Areas
List areas for a specific thana.

```bash
curl -X GET 'https://www.roadrush.xyz/api/customer/areas/?thana_id=1' \
 -H "Authorization: Bearer YOUR_TOKEN"
```
