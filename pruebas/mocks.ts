export const localMocks = [
  {
    id: 'p001',
    title: 'Galaxy S22',
    description: 'Smartphone Samsung de 128GB',
    category: 'Celulares',
    brand: 'Samsung',
    price: 18990
  },
  {
    id: 'p002',
    title: 'Samsung Galaxy S23',
    category: 'Celulares',
    price: 25990
  },
  {
    id: 'p003',
    title: 'iPhone 15',
    category: 'Celulares',
    brand: 'Apple',
    price: 34990
  },
  {
    id: 'p004',
    title: 'iPhone 15 Pro',
    category: 'Celulares',
    price: 48990
  },
  {
    id: 'p005',
    title: 'Xiaomi Redmi Note 13',
    category: 'Celulares',
    price: 8990
  },
  {
    id: 'p006',
    title: 'Lenovo ThinkPad E14',
    category: 'Notebooks',
    price: 32990
  },
  {
    id: 'p007',
    title: 'HP EliteBook 845 G8',
    category: 'Notebooks',
    price: 27990
  },
  {
    id: 'p008',
    title: 'JBL Tune 520BT',
    category: 'Audio',
    price: 2490
  },
  {
    id: 'p009',
    title: 'Sony WH-1000XM5',
    category: 'Audio',
    price: 15990
  },
  {
    id: 'p010',
    title: 'Logitech MX Master 3S',
    category: 'Periféricos',
    price: 4990
  },
  {
    id: 'p011',
    title: 'Café molido premium',
    category: 'Alimentos',
    price: 450
  },
  {
    id: 'p012',
    title: 'Cámara de seguridad WiFi',
    description: 'Cámara IP para vigilancia',
    price: 1990
  },
  {
    id: 'p013',
    title: 'Mouse inalámbrico',
    category: 'Periféricos',
    price: 790
  },
  {
    id: 'p014',
    title: 'Auriculares Bluetooth',
    category: 'Audio',
    price: 1290
  },
  {
    id: 'p015',
    title: 'Smart TV 55 pulgadas',
    category: 'Televisores',
    price: 21990
  },
  {
    id: 'p016',
    title: 'Monitor Samsung 27 pulgadas',
    category: 'Monitores',
    price: 8990
  },
  {
    id: 'p017',
    title: 'Lámpara de escritorio',
    description: 'Iluminación LED regulable',
    price: 990
  },
  {
    id: 'p018',
    title: 'Cargador USB-C 65W',
    category: 'Accesorios',
    price: 1490
  }
]

export const remoteMocks = [
  // Mismo ID, título diferente
  {
    id: 'p001',
    title: 'Samsung Galaxy S22 128GB',
    description: 'Teléfono Samsung Galaxy',
    price: 17990
  },
  {
    id: 'p003',
    title: 'Apple iPhone 15 128GB',
    category: 'Smartphones',
    price: 33990
  },
  {
    id: 'p005',
    title: 'Redmi Note 13',
    category: 'Smartphones',
    price: 8490
  },
  {
    id: 'p008',
    title: 'JBL Tune 520 BT',
    category: 'Auriculares',
    price: 2290
  },
  {
    id: 'p010',
    title: 'Mouse Logitech MX Master 3S',
    category: 'Mouse',
    price: 4590
  },
  {
    id: 'p012',
    title: 'Cámara IP Wi-Fi 1080p',
    category: 'Seguridad',
    price: 1890
  },
  {
    id: 'p015',
    title: 'Smart TV 55" 4K',
    category: 'Televisores',
    price: 20990
  },

  // Mismo título, ID diferente
  {
    id: 'r101',
    title: 'Samsung Galaxy S22',
    category: 'Celulares',
    price: 18490
  },
  {
    id: 'r102',
    title: 'Café molido premium',
    category: 'Alimentos',
    price: 490
  },

  // Errores ortográficos intencionales
  {
    id: 'r103',
    title: 'Samsng Galaxy S22',
    category: 'Smartphones'
  },
  {
    id: 'r104',
    title: 'iPohne 15',
    category: 'Celulares'
  },
  {
    id: 'r105',
    title: 'Auriculares Bluetoth',
    category: 'Audio'
  },

  // Diferencias de formato
  {
    id: 'r106',
    title: 'Cargador USB C de 65 W',
    category: 'Accesorios'
  },
  {
    id: 'r107',
    title: 'MOUSE INALÁMBRICO',
    category: 'Periféricos'
  },

  // Coincidencia únicamente en descripción
  {
    id: 'r108',
    title: 'Funda protectora',
    description: 'Compatible con Samsung Galaxy S22',
    category: 'Accesorios'
  },

  // Exclusivos de la fuente remota
  {
    id: 'r109',
    title: 'Nintendo Switch OLED',
    category: 'Consolas',
    price: 16990
  },
  {
    id: 'r110',
    title: 'Teclado mecánico RGB',
    category: 'Periféricos',
    price: 2990
  }
]
