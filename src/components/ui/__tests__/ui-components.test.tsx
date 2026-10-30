/**
 * Test di rendering per i componenti UI shadcn/ui.
 * Verifica che ogni componente si renda correttamente con le varianti
 * di default e personalizzate, e che inoltri props/className correttamente.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, badgeVariants } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

describe("Button", () => {
  it("renderizza un button con testo", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("applica la variante default", () => {
    const { container } = render(<Button>Test</Button>);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-primary");
  });

  it("applica variant e size personalizzati", () => {
    const { container } = render(
      <Button variant="destructive" size="lg">
        Delete
      </Button>,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-destructive");
    expect(btn?.className).toContain("h-11");
  });

  it("inoltra onClick handler", async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(<Button onClick={() => (clicked = true)}>Click</Button>);
    await user.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });

  it("renderizza come Slot quando asChild=true", () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Link Button" });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
  });

  it("buttonVariants ritorna stringa di classi", () => {
    const cls = buttonVariants({ variant: "outline", size: "sm" });
    expect(cls).toContain("border");
    expect(cls).toContain("h-9");
  });

  it("disabled prop disabilita il button", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("accetta className personalizzata", () => {
    const { container } = render(<Button className="custom-class">Test</Button>);
    expect(container.querySelector("button")?.className).toContain("custom-class");
  });
});

describe("Badge", () => {
  it("renderizza con testo", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applica variante default", () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.firstChild).toHaveClass("bg-primary");
  });

  it("applica variante personalizzata", () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>);
    expect(container.firstChild).toHaveClass("bg-destructive");
  });

  it("applica variante outline", () => {
    const { container } = render(<Badge variant="outline">Outlined</Badge>);
    expect(container.firstChild).toHaveClass("text-foreground");
  });

  it("applica variante secondary", () => {
    const { container } = render(<Badge variant="secondary">Secondary</Badge>);
    expect(container.firstChild).toHaveClass("bg-secondary");
  });

  it("renderizza come Slot quando asChild=true", () => {
    render(
      <Badge asChild>
        <a href="/test">Link Badge</a>
      </Badge>,
    );
    const link = screen.getByRole("link", { name: "Link Badge" });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
    expect(link).toHaveClass("bg-primary");
  });

  it("renderizza come span di default (asChild=false)", () => {
    const { container } = render(<Badge>Test</Badge>);
    expect(container.firstChild?.nodeName).toBe("SPAN");
  });

  it("badgeVariants ritorna classi", () => {
    const cls = badgeVariants({ variant: "secondary" });
    expect(cls).toContain("bg-secondary");
  });

  it("accetta className personalizzata", () => {
    const { container } = render(<Badge className="custom-badge">Test</Badge>);
    expect(container.firstChild).toHaveClass("custom-badge");
  });
});

describe("Card e sub-componenti", () => {
  it("renderizza Card con tutti i sub-componenti", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Titolo</CardTitle>
          <CardDescription>Descrizione</CardDescription>
        </CardHeader>
        <CardContent>Contenuto</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByText("Titolo")).toBeInTheDocument();
    expect(screen.getByText("Descrizione")).toBeInTheDocument();
    expect(screen.getByText("Contenuto")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("Card applica className personalizzata", () => {
    const { container } = render(<Card className="custom-card" />);
    expect(container.firstChild).toHaveClass("custom-card");
  });

  it("CardAction renderizza con className", () => {
    const { container } = render(<CardAction className="custom-action">Azione</CardAction>);
    const action = container.querySelector("[data-slot='card-action']");
    expect(action).toBeInTheDocument();
    expect(action).toHaveClass("custom-action");
  });

  it("CardHeader renderizza con className", () => {
    const { container } = render(<CardHeader className="custom-header">Header</CardHeader>);
    const header = container.querySelector("[data-slot='card-header']");
    expect(header).toHaveClass("custom-header");
  });

  it("CardTitle renderizza con className", () => {
    const { container } = render(<CardTitle className="custom-title">Titolo</CardTitle>);
    const title = container.querySelector("[data-slot='card-title']");
    expect(title).toHaveClass("custom-title");
  });

  it("CardDescription renderizza con className", () => {
    const { container } = render(<CardDescription className="custom-desc">Desc</CardDescription>);
    const desc = container.querySelector("[data-slot='card-description']");
    expect(desc).toHaveClass("custom-desc");
  });

  it("CardContent renderizza con className", () => {
    const { container } = render(<CardContent className="custom-content">Content</CardContent>);
    const content = container.querySelector("[data-slot='card-content']");
    expect(content).toHaveClass("custom-content");
  });

  it("CardFooter renderizza con className", () => {
    const { container } = render(<CardFooter className="custom-footer">Footer</CardFooter>);
    const footer = container.querySelector("[data-slot='card-footer']");
    expect(footer).toHaveClass("custom-footer");
  });
});

describe("Checkbox", () => {
  it("renderizza un checkbox", () => {
    const { container } = render(<Checkbox />);
    const btn = container.querySelector("button");
    expect(btn).toBeInTheDocument();
    expect(btn?.getAttribute("role")).toBe("checkbox");
  });

  it("inoltra onClick handler", async () => {
    const user = userEvent.setup();
    let clicked = false;
    const { container } = render(<Checkbox onClick={() => (clicked = true)} />);
    await user.click(container.querySelector("button") as HTMLButtonElement);
    expect(clicked).toBe(true);
  });

  it("applica id per label association", () => {
    const { container } = render(<Checkbox id="my-cb" />);
    expect(container.querySelector("button")?.id).toBe("my-cb");
  });
});

describe("Input", () => {
  it("renderizza un input text", () => {
    render(<Input placeholder="Scrivi..." />);
    expect(screen.getByPlaceholderText("Scrivi...")).toBeInTheDocument();
  });

  it("accetta type password", () => {
    render(<Input type="password" data-testid="pw" />);
    const input = screen.getByTestId("pw");
    expect(input.getAttribute("type")).toBe("password");
  });

  it("accetta className personalizzata", () => {
    render(<Input className="my-input" data-testid="i" />);
    expect(screen.getByTestId("i")).toHaveClass("my-input");
  });

  it("inoltra disabled prop", () => {
    render(<Input disabled data-testid="i" />);
    expect(screen.getByTestId("i")).toBeDisabled();
  });
});

describe("Label", () => {
  it("renderizza una label", () => {
    render(<Label htmlFor="x">Nome</Label>);
    expect(screen.getByText("Nome")).toBeInTheDocument();
    expect(screen.getByText("Nome").getAttribute("for")).toBe("x");
  });

  it("accetta className personalizzata", () => {
    render(<Label className="my-label">Test</Label>);
    expect(screen.getByText("Test")).toHaveClass("my-label");
  });
});

describe("Textarea", () => {
  it("renderizza una textarea", () => {
    render(<Textarea placeholder="Scrivi..." />);
    expect(screen.getByPlaceholderText("Scrivi...")).toBeInTheDocument();
  });

  it("accetta rows personalizzato", () => {
    render(<Textarea rows={10} data-testid="ta" />);
    expect(screen.getByTestId("ta").getAttribute("rows")).toBe("10");
  });
});

describe("Switch", () => {
  it("renderizza uno switch", () => {
    const { container } = render(<Switch />);
    const btn = container.querySelector("button");
    expect(btn).toBeInTheDocument();
    expect(btn?.getAttribute("role")).toBe("switch");
  });

  it("inoltra onClick", async () => {
    const user = userEvent.setup();
    let clicked = false;
    const { container } = render(<Switch onClick={() => (clicked = true)} />);
    await user.click(container.querySelector("button") as HTMLButtonElement);
    expect(clicked).toBe(true);
  });
});

describe("Tabs", () => {
  it("renderizza tabs con trigger e content", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Contenuto A</TabsContent>
        <TabsContent value="b">Contenuto B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("Contenuto A")).toBeInTheDocument();
    expect(screen.getByText("Tab A")).toBeInTheDocument();
    expect(screen.getByText("Tab B")).toBeInTheDocument();
  });

  it("cambia tab al click", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Contenuto A</TabsContent>
        <TabsContent value="b">Contenuto B</TabsContent>
      </Tabs>,
    );
    await user.click(screen.getByText("Tab B"));
    expect(screen.getByText("Contenuto B")).toBeInTheDocument();
  });
});
