# 🚀 RoadRush Customer API Documentation

## 🔐 1. Login

**Endpoint:**

```
POST /api/customer/login/
```

**cURL:**

```bash
curl -X POST https://www.roadrush.xyz/api/customer/login/ \
     -H "Content-Type: application/json" \
     -d '{"username":"YOUR_USERNAME", "password":"YOUR_PASSWORD"}'
```

**Response:**

```json
// Paste response here
```

---

## 📍 2. Get Sender Address

**Endpoint:**

```
GET /api/customer/sender-address/
```

**cURL:**

```bash
curl -X GET https://www.roadrush.xyz/api/customer/sender-address/ \
     -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
    "status": "success",
    "count": 1,
    "sender_addresses": [
        {
            "id": 17,
            "name": "vendor test",
            "address": "North shajatpur, Gulshan, dhaka, bangladesh",
            "sender_full_name": "vendor test",
            "sender_address": "North shajatpur, Gulshan, dhaka, bangladesh",
            "division": "Dhaka",
            "district": "Dhaka",
            "thana": "Gulshan",
            "area": null,
            "sender_unit_or_floor": "ka/9",
            "sender_phone_number": "01911015506",
            "pickup_note": "Opposit side of subastu toweer",
            "sender_thana_id": "504",
            "sender_rdx_id": "1847",
            "sender_bili_thana": "Uttara-1230",
            "zip_code": "1213",
            "pathao_city_id": "1",
            "pathao_zone_id": "4",
            "sender_latitude": "23.789224",
            "sender_longitude": "90.423148",
            "pathao_store_id": "168795",
            "redx_store_id": "430001",
            "piickme_store_id": null,
            "pandago_store_id": null,
            "edesh_store_id": null,
            "hub_id": "18490",
            "is_send_pathao_store_create": true,
            "created_at": "2023-12-31T18:48:28.607730+06:00",
            "updated_at": "2026-02-24T16:31:55.266520+06:00",
            "marcent": 1,
            "user": 2
        }
    ]
}
```

---

## ➕ 3. Add Pickup Address

**Endpoint:**

```
POST /api/customer/add-pickup-address/
```

**cURL:**

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

**Response:**

```json
// Paste response here
```

---

## 📦 4. Get Aggregator List

**Endpoint:**

```
GET /api/customer/aggregators/
```

**cURL:**

```bash
curl --location 'https://www.roadrush.xyz/api/customer/aggregators/' \
--header 'Authorization: Bearer YOUR_TOKEN'
```

**Response:**

```json
{
    "status": "success",
    "count": 9,
    "aggregators": [
        {
            "id": 1,
            "name": "paperfly",
            "description": null,
            "logo": null,
            "status": true,
            "order_delivery_time": null,
            "order_place_time": null
        },
        {
            "id": 2,
            "name": "pandaGo",
            "description": null,
            "logo": null,
            "status": true,
            "order_delivery_time": null,
            "order_place_time": null
        }
    ]
}
```

---

## 🚴 5. Request a Rider (Place Order)

**Endpoint:**

```
POST /api/customer/place-order/
```

**cURL:**

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

**Response:**

```json
// Paste response here
```

---

## 📜 6. Get All Orders

**Endpoint:**

```
GET /api/customer/order-history/
```

**cURL:**

```bash
curl -X GET https://www.roadrush.xyz/api/customer/order-history/ \
     -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
    "status": "success",
    "count": 22,
    "orders": [
        {
            "id": 2321212,
            "order_code": "rd#1-bd1c54",
            "customer_full_name": "Bijon Krishna Bairagi",
            "item_value": 500.0,
            "status": "Cancel",
            "created_at": "2026-04-06T10:07:56.166987+06:00",
            "item_details": "",
            "Order_Code": "rd#1-bd1c54",
            "Customer_FullName": "Bijon Krishna Bairagi",
            "Item_value": 500.0,
            "created": "2026-04-06T10:07:56.166987+06:00"
        },
        {
            "id": 2321154,
            "order_code": "rd#1-79b7a3",
            "customer_full_name": "Bijon Krishna Bairagi",
            "item_value": 150.0,
            "status": "Order Place",
            "created_at": "2026-03-30T10:27:13.959742+06:00",
            "item_details": "Shirt",
            "Order_Code": "rd#1-79b7a3",
            "Customer_FullName": "Bijon Krishna Bairagi",
            "Item_value": 150.0,
            "created": "2026-03-30T10:27:13.959742+06:00"
        }
    ]
}
```

---

## 🔍 7. Get Order Details

**Endpoint:**

```
POST /api/customer/order_details/
```

**cURL:**

```bash
curl --location 'https://www.roadrush.xyz/api/customer/order_details/' \
--header 'Authorization: Bearer YOUR_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
    "order_code": "ORDER_CODE"
}'
```

**Response:**

```json
{
    "status": "success",
    "order": {
        "id": 2321212,
        "order_code": "rd#1-bd1c54",
        "customer_full_name": "Bijon Krishna Bairagi",
        "customer_mobile_number": "01911015506",
        "status": "Cancel",
        "drop_address": "Dumuria bazar",
        "item_value": 500.0,
        "cod": true,
        "item_details": "",
        "receiver_division": "Khulna",
        "receiver_district": "Khulna",
        "receiver_thana": "Dumuria",
        "Cash_Collect": 500.0,
        "distance_km": 0.0,
        "Fee": 0.0,
        "COD_charge": 0.0,
        "Vat": 0.0,
        "Tax": 0.0,
        "created": "2026-04-06T10:07:56.166987+06:00",
        "updated": "2026-04-06T19:30:00.354866+06:00",
        "delivery_priority": "now",
        "Dop_Note": "",
        "otp": "505577",
        "rcv_pay": true,
        "RequestDeliveryDate": "2026-04-06",
        "status_details": [
            {
                "status_name": "Order Place",
                "Description": "Order Place",
                "Created_at": "2026-04-06T10:07:56.184409+06:00",
                "Created_by": 2
            },
            {
                "status_name": "Cancel",
                "Description": "Cancel",
                "Created_at": "2026-04-06T19:30:00.438150+06:00",
                "Created_by": 3
            }
        ],
        "comments": []
    }
}
```

---

## 🌍 8. Get Divisions

**Endpoint:**

```
GET /api/customer/divisions/
```

**cURL:**

```bash
curl -X GET https://www.roadrush.xyz/api/customer/divisions/ \
-H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
    "status": "success",
    "data": [
        {
            "name": "Barisal",
            "id": "-Nn8qoSh88yPqgPPnnFV"
        },
        {
            "name": "Sylhet",
            "rdx_id": 0,
            "id": "-Nn8qqTmpGEWUsRxXtCh"
        }
    ]
}
```

---

## 🏙️ 9. Get Districts

**Endpoint:**

```
GET /api/customer/districts/?division_id=1
```

**cURL:**

```bash
curl -X GET 'https://www.roadrush.xyz/api/customer/districts/?division_id=1' \
-H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
    "status": "success",
    "data": [
        {
            "bili_name": "Sylhet",
            "div_id": "-Nn8qqTmpGEWUsRxXtCh",
            "div_name": "Sylhet",
            "name": "Sylhet",
            "pathao_id": "3",
            "pathao_name": "",
            "id": "-No6oF7HCUzRuaXabtqw"
        }
    ]
}
```

---

## 🏘️ 10. Get Thanas

**Endpoint:**

```
GET /api/customer/thanas/?district_id=1
```

**cURL:**

```bash
curl -X GET 'https://www.roadrush.xyz/api/customer/thanas/?district_id=1' \
-H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
    "status": "success",
    "data": [
        {
            "bili_name": "Maulvi Bazar Sadar-3200",
            "dist_id": "-No6oGXPyKHyNHXeuJZT",
            "dist_name": "Moulvibazar",
            "div_id": "-Nn8qqTmpGEWUsRxXtCh",
            "div_name": "Sylhet",
            "ecourier": "Barlekha",
            "ecourier_hub_id": "18609",
            "edesh_id": "",
            "name": "Barlekha",
            "pathao_id": "676",
            "pathao_name": "Barlekha",
            "rdx_id": "893",
            "zip_code": "3250",
            "id": "-Nofp6g6n9moo87pCSQ8"
        }
    ]
}
```

---

## 📌 11. Get Areas

**Endpoint:**

```
GET /api/customer/areas/?thana_id=1
```

**cURL:**

```bash
curl -X GET 'https://www.roadrush.xyz/api/customer/areas/?thana_id=1' \
-H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
    "status": "success",
    "data": [
        {
            "dist_id": "-No6oGXPyKHyNHXeuJZT",
            "dist_name": "Moulvibazar",
            "div_id": "-Nn8qqTmpGEWUsRxXtCh",
            "div_name": "Sylhet",
            "edesh_id": "",
            "name": "Alinagar",
            "pathao_id": "",
            "pathao_name": "",
            "rdx_id": "894",
            "upazila_id": "-NofpDImpksalCS2UVfc",
            "upazila_name": "Kamolganj",
            "zip_code": "",
            "id": "-NqXLhsdi17OKKk0F-ly"
        }
    ]
}
```

---

# 📝 Notes

- Replace `YOUR_TOKEN` with your actual JWT token.
- Replace request fields as per your business logic.
- Paste actual API responses under each section for debugging and documentation.
