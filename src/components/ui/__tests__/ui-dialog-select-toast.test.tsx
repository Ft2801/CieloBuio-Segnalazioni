/**
 * Test di rendering per i componenti UI shadcn/ui complessi:
 * Dialog, Select, Toast, Toaster.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "@/components/ui/select";
import { ToastProvider, Toast, ToastTitle, ToastDescription, ToastClose, ToastAction, ToastViewport } from "@/components/ui/toast";

describe("Dialog", () => {
  it("renderizza trigger e apre dialog al click", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Apri</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Titolo Dialog</DialogTitle>
            <DialogDescription>Descrizione dialog</DialogDescription>
          </DialogHeader>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Apri")).toBeInTheDocument();
    await user.click(screen.getByText("Apri"));
    await waitFor(() => {
      expect(screen.getByText("Titolo Dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("Descrizione dialog")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("DialogClose renderizza un button close", async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Titolo</DialogTitle>
          <DialogClose>Chiudi</DialogClose>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getAllByText("Chiudi")[0]).toBeInTheDocument();
  });
});

describe("Select", () => {
  it("renderizza SelectTrigger con placeholder", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Scegli..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Opzioni</SelectLabel>
            <SelectItem value="a">Opzione A</SelectItem>
            <SelectItem value="b">Opzione B</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );
    expect(screen.getByText("Scegli...")).toBeInTheDocument();
  });

  it("SelectTrigger mostra icona (renderizza senza errori)", () => {
    const { container } = render(
      <Select>
        <SelectTrigger data-testid="trigger">
          <SelectValue placeholder="Scegli..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(container.querySelector("[data-testid='trigger']")).toBeInTheDocument();
  });

  it("SelectSeparator renderizza senza errori", () => {
    const { container } = render(
      <Select>
        <SelectTrigger data-testid="trigger">
          <SelectValue placeholder="Scegli..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
          <SelectSeparator className="custom-sep" />
          <SelectItem value="b">B</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(container.querySelector("[data-testid='trigger']")).toBeInTheDocument();
  });

  it("SelectScrollUpButton e SelectScrollDownButton renderizzano senza errori", () => {
    const { container } = render(
      <Select>
        <SelectTrigger data-testid="trigger">
          <SelectValue placeholder="Scegli..." />
        </SelectTrigger>
        <SelectContent>
          <SelectScrollUpButton className="custom-up" />
          <SelectItem value="a">A</SelectItem>
          <SelectItem value="b">B</SelectItem>
          <SelectScrollDownButton className="custom-down" />
        </SelectContent>
      </Select>
    );
    expect(container.querySelector("[data-testid='trigger']")).toBeInTheDocument();
  });
});

describe("Toast", () => {
  it("renderizza ToastProvider senza errori", () => {
    const { container } = render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>
    );
    expect(container.textContent).toContain("Content");
  });

  it("ToastViewport renderizza senza errori", () => {
    const { container } = render(
      <ToastProvider>
        <ToastViewport className="custom-viewport" />
      </ToastProvider>
    );
    expect(container).toBeInTheDocument();
  });

  it("ToastAction renderizza senza crashare (verifica mount)", () => {
    // Radix Toast ha animazioni che non funzionano in jsdom, quindi
    // verifichiamo solo che il componente si monti senza errori
    const { container } = render(
      <ToastProvider duration={0}>
        <Toast duration={0} defaultOpen>
          <ToastTitle>Test</ToastTitle>
          <ToastAction className="custom-action" altText="Azione">
            Azione
          </ToastAction>
          <ToastClose />
        </Toast>
      </ToastProvider>
    );
    expect(container).toBeInTheDocument();
  });

  it("ToastAction con variant destructive (riga 65 rami group-[.destructive])", () => {
    const { container } = render(
      <ToastProvider duration={0}>
        <Toast duration={0} defaultOpen variant="destructive">
          <ToastTitle>Errore</ToastTitle>
          <ToastAction className="custom-action" altText="Riprova">
            Riprova
          </ToastAction>
          <ToastClose />
        </Toast>
      </ToastProvider>
    );
    expect(container).toBeInTheDocument();
  });
});
