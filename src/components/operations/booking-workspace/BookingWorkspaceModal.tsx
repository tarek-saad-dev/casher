'use client';

import { CheckCircle2 } from 'lucide-react';
import { BookingWorkspaceFooter } from './BookingWorkspaceFooter';
import { BookingWorkspaceHeader } from './BookingWorkspaceHeader';
import { BookingStepAppointment } from './BookingStepAppointment';
import { BookingStepBarber } from './BookingStepBarber';
import { BookingStepCustomer } from './BookingStepCustomer';
import { BookingStepReview } from './BookingStepReview';
import { BookingStepServices } from './BookingStepServices';
import { BookingWorkspaceStepper } from './BookingWorkspaceStepper';
import { BookingWorkspaceSummary, BookingWorkspaceSummaryMobile } from './BookingWorkspaceSummary';
import { useBookingWorkspace, type UseBookingWorkspaceArgs } from './useBookingWorkspace';
import { BORDER } from './types';

export type BookingWorkspaceModalProps = UseBookingWorkspaceArgs;

export function BookingWorkspaceModal(props: BookingWorkspaceModalProps) {
  const ws = useBookingWorkspace(props);
  const { open, onClose } = props;

  if (!open) return null;

  const canProceedForStep = (): boolean => {
    switch (ws.step) {
      case 1: return ws.canGoStep2;
      case 2: return ws.canGoStep3;
      case 3: return ws.canGoStep4;
      case 4: return ws.canGoStep5;
      case 5: return ws.canSubmit;
      default: return false;
    }
  };

  const handlePrimary = () => {
    if (ws.step === 5) {
      void ws.handleSubmit();
      return;
    }
    ws.goNext();
  };

  if (ws.success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" dir="rtl">
        <div className="rounded-2xl border p-10 text-center space-y-3 max-w-md w-full" style={{ background: 'var(--surface-elevated)', borderColor: BORDER }}>
          <CheckCircle2 size={48} className="text-success mx-auto" />
          <p className="font-bold text-foreground text-xl">تم إنشاء الحجز</p>
          <p className="text-sm text-muted-foreground">
            {ws.formatDateLabel(ws.bookingDate)}
            {ws.selectedSlot ? ` — ${ws.selectedSlot.label}` : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 md:p-6 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
      dir="rtl"
    >
      <div
        ref={ws.modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-workspace-title"
        className="flex flex-col w-full h-[100dvh] sm:h-[min(90vh,900px)] sm:w-[min(90vw,1280px)] sm:max-w-[1280px] sm:rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          background: 'var(--surface-elevated)',
          borderColor: BORDER,
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <BookingWorkspaceHeader
          step={ws.step}
          bookingDate={ws.bookingDate}
          mode={ws.mode}
          totalDuration={ws.totalDuration}
          selectedServicesCount={ws.selectedServices.length}
          showDatePicker={ws.showDatePicker}
          onToggleDatePicker={() => ws.setShowDatePicker((v) => !v)}
          onDateChange={ws.handleDateChange}
          onClose={onClose}
          getCairoToday={ws.getCairoToday}
          getCairoTomorrow={ws.getCairoTomorrow}
        />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <BookingWorkspaceStepper
            step={ws.step}
            summaries={ws.stepSummaries}
            onGoToStep={ws.goToStep}
          />

          <main className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
            {ws.step === 1 && (
              <BookingStepBarber
                mode={ws.mode}
                barbers={ws.barbers}
                selectedBarberId={ws.selectedBarberId}
                lockedBarber={ws.lockedBarber}
                initialBarberName={ws.initialBarberName}
                onModeChange={ws.handleModeChange}
                onSelectBarber={ws.handleSelectBarber}
              />
            )}
            {ws.step === 2 && (
              <BookingStepServices
                services={ws.services}
                selectedServices={ws.selectedServices}
                serviceIds={ws.serviceIds}
                loadingServices={ws.loadingServices}
                totalDuration={ws.totalDuration}
                totalPrice={ws.totalPrice}
                onSelectMain={ws.handleMainSelect}
                onToggleAddon={ws.handleToggleAddon}
                onRemoveService={ws.removeService}
              />
            )}
            {ws.step === 3 && (
              <BookingStepAppointment
                mode={ws.mode}
                bookingDate={ws.bookingDate}
                selectedBarberName={ws.selectedBarberName}
                selectedServices={ws.selectedServices}
                totalDuration={ws.totalDuration}
                displaySlots={ws.displaySlots}
                availableSlots={ws.availableSlots}
                preferredRangeSlots={ws.preferredRangeSlots}
                loadingSlots={ws.loadingSlots}
                slotsAreCurrent={ws.slotsAreCurrent}
                selectedSlot={ws.selectedSlot}
                gapNotice={ws.gapNotice}
                slotsDebugReason={ws.slotsDebugReason}
                nextAvailable={ws.nextAvailable}
                alternativeBarbers={ws.alternativeBarbers}
                hasTimeRange={ws.hasTimeRange}
                filterByTimeRange={ws.filterByTimeRange}
                initialTimeRangeStart={ws.initialTimeRangeStart}
                initialTimeRangeEnd={ws.initialTimeRangeEnd}
                lockedBarber={ws.lockedBarber}
                onSelectSlot={ws.setSelectedSlot}
                onToggleTimeRangeFilter={() => ws.setFilterByTimeRange((v) => !v)}
                onChangeServices={() => ws.goToStep(2)}
                onChangeDate={() => ws.setShowDatePicker(true)}
                onSwitchNearest={() => { ws.handleModeChange('nearest'); ws.goToStep(1); }}
                onSelectAlternativeBarber={(empId) => {
                  ws.handleModeChange('specific');
                  ws.setSelectedBarberId(empId);
                  ws.goToStep(1);
                }}
              />
            )}
            {ws.step === 4 && (
              <BookingStepCustomer
                customerName={ws.customerName}
                customerPhone={ws.customerPhone}
                notes={ws.notes}
                clientSearch={ws.clientSearch}
                clients={ws.clients}
                selectedClient={ws.selectedClient}
                showClients={ws.showClients}
                onCustomerNameChange={ws.setCustomerName}
                onCustomerPhoneChange={ws.setCustomerPhone}
                onNotesChange={ws.setNotes}
                onClientSearchChange={ws.setClientSearch}
                onSelectClient={(c) => { ws.setSelectedClient(c); ws.setClientSearch(''); ws.setShowClients(false); }}
                onClearClient={() => ws.setSelectedClient(null)}
                onShowClients={ws.setShowClients}
              />
            )}
            {ws.step === 5 && (
              <BookingStepReview
                mode={ws.mode}
                bookingDate={ws.bookingDate}
                selectedBarberName={ws.selectedBarberName}
                selectedServices={ws.selectedServices}
                totalDuration={ws.totalDuration}
                totalPrice={ws.totalPrice}
                selectedSlot={ws.selectedSlot}
                customerName={ws.customerName}
                customerPhone={ws.customerPhone}
                selectedClientName={ws.selectedClient?.Name}
                notes={ws.notes}
                error={ws.error}
              />
            )}
          </main>

          <BookingWorkspaceSummary
            step={ws.step}
            mode={ws.mode}
            bookingDate={ws.bookingDate}
            selectedBarberName={ws.selectedBarberName}
            selectedServices={ws.selectedServices}
            totalDuration={ws.totalDuration}
            totalPrice={ws.totalPrice}
            selectedSlot={ws.selectedSlot}
            customerName={ws.customerName}
            selectedClientName={ws.selectedClient?.Name}
            stepHint={ws.stepHint}
            error={ws.error}
            canProceed={canProceedForStep()}
            isFinalStep={ws.step === 5}
            submitting={ws.submitting}
            onPrimary={handlePrimary}
          />
        </div>

        <BookingWorkspaceSummaryMobile
          totalDuration={ws.totalDuration}
          totalPrice={ws.totalPrice}
          selectedServicesCount={ws.selectedServices.length}
          stepHint={ws.stepHint}
          canProceed={canProceedForStep()}
          isFinalStep={ws.step === 5}
          submitting={ws.submitting}
          onPrimary={handlePrimary}
        />

        <BookingWorkspaceFooter
          step={ws.step}
          canGoBack={ws.step > 1}
          canProceed={canProceedForStep()}
          isFinalStep={ws.step === 5}
          submitting={ws.submitting}
          stepHint={ws.stepHint}
          onBack={ws.goBack}
          onPrimary={handlePrimary}
        />
      </div>
    </div>
  );
}
