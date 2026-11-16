
type MockProduct = {
  id: string
  title: string
  brand: string
  category: string
  description: string
  price: number
}

const catalog = [
  {
    brand: 'Samsung',
    category: 'Celulares',
    models: ['Galaxy S22', 'Galaxy S23', 'Galaxy S24', 'Galaxy A54', 'Galaxy Z Flip']
  },
  {
    brand: 'Apple',
    category: 'Celulares',
    models: ['iPhone 13', 'iPhone 14', 'iPhone 15', 'iPhone 16', 'iPhone 16 Pro']
  },
  {
    brand: 'Xiaomi',
    category: 'Celulares',
    models: ['Redmi Note 13', 'Redmi 12', 'Poco X6', 'Poco F6']
  },
  {
    brand: 'Lenovo',
    category: 'Notebooks',
    models: ['ThinkPad E14', 'ThinkPad T14', 'IdeaPad 3', 'Legion 5']
  },
  {
    brand: 'HP',
    category: 'Notebooks',
    models: ['EliteBook 845 G8', 'ProBook 450', 'Victus 15', 'Pavilion 14']
  },
  {
    brand: 'ASUS',
    category: 'Computadoras',
    models: ['ROG Strix', 'Zenbook 14', 'Vivobook 15', 'TUF Gaming']
  },
  {
    brand: 'Logitech',
    category: 'Periféricos',
    models: ['MX Master 3S', 'G502', 'G Pro X', 'K380', 'M720']
  },
  {
    brand: 'Sony',
    category: 'Audio',
    models: ['WH-1000XM5', 'WF-1000XM4', 'SRS-XB100', 'Pulse 3D']
  },
  {
    brand: 'JBL',
    category: 'Audio',
    models: ['Tune 520BT', 'Flip 6', 'Charge 5', 'Live 660NC']
  },
  {
    brand: 'LG',
    category: 'Monitores',
    models: ['UltraGear 27', 'UltraWide 34', 'OLED 42', 'Smart TV 55']
  },
  {
    brand: 'Nintendo',
    category: 'Consolas',
    models: ['Switch OLED', 'Switch Lite', 'Switch 2', 'Pro Controller']
  },
  {
    brand: 'Kingston',
    category: 'Almacenamiento',
    models: ['NV2 1TB', 'A400 480GB', 'Fury Beast', 'DataTraveler']
  }
]

const sourceNames = [
  'local',
  'remote',
  'warehouse',
  'supplier',
  'external',
  'backup',
  'marketplace',
  'legacy'
]

function createProduct (index: number): MockProduct {
  const entry = catalog[index % catalog.length]

  const modelIndex = Math.floor(index / catalog.length) % entry.models.length
  const model = entry.models[modelIndex]

  const version = Math.floor(index / 100)
  const capacity = ['64GB', '128GB', '256GB', '512GB'][index % 4]

  return {
    id: `p${index}`,
    title: `${entry.brand} ${model} ${capacity} Ref-${version}`,
    brand: entry.brand,
    category: entry.category,
    description: `${entry.category} ${entry.brand} ${model}, versión ${version}`,
    price: 1000 + ((index * 137) % 85000)
  }
}

function changeTitle (title: string, variant: number): string {
  switch (variant % 8) {
    case 0:
      return title.toUpperCase()

    case 1:
      return title.toLowerCase()

    case 2:
      return title.replace('Samsung', 'Samsng')

    case 3:
      return title.replace('Apple', 'Aple')

    case 4:
      return title.replace('Galaxy', 'Galaxi')

    case 5:
      return title.replace(' ', '-')

    default:
      return title
  }
}

export function generateStressMocks (
  total = 100_000,
  sourceCount = 5
) {
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new Error('total debe ser un entero positivo')
  }

  if (!Number.isInteger(sourceCount) || sourceCount < 1) {
    throw new Error('sourceCount debe ser un entero positivo')
  }

  const uniqueCount = Math.max(1, Math.floor(total * 0.65))

  const baseProducts = Array.from(
    { length: uniqueCount },
    (_, index) => createProduct(index)
  )

  const sources = Array.from(
    { length: sourceCount },
    (_, sourceIndex) => {
      const origin = sourceNames[sourceIndex] ?? `source-${sourceIndex}`

      const start = Math.floor(total * sourceIndex / sourceCount)
      const end = Math.floor(total * (sourceIndex + 1) / sourceCount)
      const count = end - start

      const items = Array.from({ length: count }, (_, i) => {
        // Distintas fuentes comparten productos del catálogo base.
        const baseIndex = (i * 37 + sourceIndex * 1013) % uniqueCount
        const base = baseProducts[baseIndex]

        return {
          ...base,

          // Algunos duplicados mantienen el ID; otros no.
          id: i % 7 === 0
            ? `${origin}-${baseIndex}`
            : base.id,

          title: changeTitle(base.title, i + sourceIndex),

          // Los precios cambian según la fuente.
          price: base.price + sourceIndex * 50
        }
      })

      return (_query: string) => ({
        origin,
        items
      })
    }
  )

  return {
    sources,
    total,
    sourceCount,
    uniqueCount
  }
}
