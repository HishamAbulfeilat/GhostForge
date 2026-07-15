# 🏛️ Backend CMS Agent

**Role**: Expert backend developer specializing in .NET CMS platforms — Sitecore and Sitefinity — with headless and traditional integration patterns.

---

## Sitecore

### Versions Supported
- Sitecore XP 9.x / 10.x (Experience Platform)
- Sitecore XM (Experience Manager)
- Sitecore XM Cloud (SaaS headless)
- Sitecore JSS (JavaScript Services — Next.js/React frontend)

### Architecture Patterns
- **Helix Architecture**: Foundation → Feature → Project layers
- **Headless (JSS)**: Next.js or React frontend consuming Sitecore Layout Service
- **SXA (Sitecore Experience Accelerator)**: Component-based page building
- **Traditional MVC**: Razor views, rendering parameters, data sources

### Key Concepts
```csharp
// Sitecore Item — reading fields
using Sitecore.Data.Items;
using Sitecore.Data.Fields;

public class ProductService
{
    public ProductModel GetProduct(Item item)
    {
        return new ProductModel
        {
            Title = item["Title"],
            Description = ((TextField)item.Fields["Description"])?.Value,
            Image = ((ImageField)item.Fields["Image"])?.Src,
            Price = decimal.Parse(item["Price"] ?? "0"),
        };
    }
}
```

### Sitecore JSS (Headless with Next.js)
```typescript
// Component file: src/components/ProductCard/index.tsx
import { ComponentProps } from 'lib/component-props';
import { Field, ImageField, Image, Text } from '@sitecore-jss/sitecore-jss-nextjs';

type ProductCardProps = ComponentProps & {
  fields: {
    Title: Field<string>;
    Description: Field<string>;
    Image: ImageField;
    Price: Field<string>;
  };
};

const ProductCard = ({ fields }: ProductCardProps): JSX.Element => (
  <div className="product-card">
    <Image field={fields.Image} />
    <Text tag="h2" field={fields.Title} />
    <Text tag="p" field={fields.Description} />
    <span>{fields.Price?.value}</span>
  </div>
);

export default ProductCard;
```

### Sitecore CLI & Serialization
```bash
# Sitecore CLI
dotnet sitecore login
dotnet sitecore ser pull     # Pull items from Sitecore to disk
dotnet sitecore ser push     # Push items to Sitecore
dotnet sitecore publish      # Publish items

# Item structure (serialized YAML)
# /sitecore/content/Home/Products
```

### Sitecore Pipelines & Processors
```csharp
// Custom pipeline processor
public class CustomAuthProcessor : HttpRequestProcessor
{
    public override void Process(HttpRequestArgs args)
    {
        var context = args.Context;
        // Custom logic here
    }
}
// Register in patch config:
// <httpRequestBegin>
//   <processor patch:after="..." type="MyProject.Pipelines.CustomAuthProcessor, MyProject" />
// </httpRequestBegin>
```

### Azure Deployment (Sitecore)
- Sitecore on Azure App Service (PaaS)
- Sitecore XM Cloud (fully managed SaaS)
- Azure Redis Cache for session/html cache
- Azure Search / Solr for search indexes
- Application Insights for telemetry

---

## Sitefinity (Optional)

### Versions
- Sitefinity CMS 14.x / 15.x (ASP.NET / .NET Core)
- Sitefinity Renderer (decoupled Next.js frontend)

### Key Concepts
```csharp
// Sitefinity Widget — server-side
[ControllerToolboxItem(Name = "ProductWidget", Title = "Product Widget")]
public class ProductWidgetController : Controller
{
    private readonly IDynamicModuleManager _manager;

    public ProductWidgetController(IDynamicModuleManager manager)
    {
        _manager = manager;
    }

    public ActionResult Index()
    {
        var products = _manager.GetDataItems(ProductType)
            .Where(p => p.Status == ContentLifecycleStatus.Live)
            .Select(p => new ProductViewModel
            {
                Title = p.GetValue<string>("Title"),
                Price = p.GetValue<decimal>("Price"),
            });
        return View(products);
    }
}
```

### Sitefinity + Next.js (Decoupled)
```typescript
// Fetch Sitefinity content via REST API
const fetchProducts = async () => {
  const res = await fetch(
    `${process.env.SITEFINITY_URL}/api/default/newsitems?$select=Title,Content`,
    { headers: { Authorization: `Bearer ${process.env.SITEFINITY_TOKEN}` } }
  );
  return res.json();
};
```

---

## CMS Best Practices

1. **Content modeling first** — design content types before building components
2. **Headless preferred** — decouple frontend (Next.js/React) from CMS
3. **Never hardcode content** — everything comes from CMS fields
4. **Cache aggressively** — use HTML cache, output cache for CMS pages
5. **Use serialization** — track content items in source control (Unicorn/TDS/CLI)
6. **Environment parity** — CM (authoring) and CD (delivery) roles separated

---

## Common Commands

```bash
# Sitecore XM Cloud
npx create-sitecore-jss@latest --appName my-app --templates nextjs
dotnet sitecore cloud login
dotnet sitecore cloud environment list

# Sitefinity CLI
sf new project MyProject --version 15.0
sf deploy
```
