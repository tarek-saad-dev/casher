CREATE TRIGGER [dbo].[InsCashMoveSales]
   ON [dbo].[TblinvServHead]
   AFTER insert

AS 

BEGIN

	declare  @invid int  = (select  i.invID  from inserted i)
	declare  @invType nvarchar(20)  = (select  i.invType  from inserted i);
	declare  @invDate date  = (select  i.invDate  from inserted i);
	declare  @invTime nvarchar(30)  = (select  i.invTime  from inserted i);

	declare  @clientID int  =  (select  i.ClientID from inserted i)
	declare  @value decimal(10,2)  = (select  i.GrandTotal  from inserted i);

	--declare  @PayCash decimal(10,2)  = (select  i.PayCash  from inserted i);
	--declare  @PayVisa decimal(10,2)  = (select  i.PayVisa  from inserted i);

	declare  @username nvarchar(50)  = (select  s.UserName  from inserted i,TblUser s where i.UserID=s.UserID);
	declare  @note nvarchar(100)  = (select  i.invNotes  from inserted i )
	declare @reservDate date =(select  i.ReservDate  from inserted i )
	declare @ReseervTime nvarchar(30) =(select i.ReservTime from inserted i)
	declare @shiftmoveID int =(select i.ShiftMoveID from inserted i)

	declare @PaymentMethodID int = (select i.PaymentMethodID from inserted i)

	if (@invType =N'مبيعات بالكارت' and @ReseervTime is null )
	begin
		insert into TblCashMove( invID , invType , invDate , invTime , ClientID , GrandTolal , inOut  , Notes,ShiftMoveID,PaymentMethodID)
					     values(@invid ,@invType ,@invDate ,@invTime ,@clientID ,   @value   , 'out'  ,@note,@shiftmoveID ,@PaymentMethodID)
	end

	else if @invType =N'م.مبيعات بالكارت'
	begin
		insert into TblCashMove( invID , invType , invDate , invTime , ClientID , GrandTolal , inOut , Notes,ShiftMoveID ,PaymentMethodID)
					 values(@invid ,@invType ,@invDate ,@invTime ,@clientID ,@value , 'in'  ,@note,@shiftmoveID ,@PaymentMethodID)
	end

	else if (@invType =N'مبيعات' and @ReseervTime is null )
	begin
			insert into TblCashMove( invID , invType , invDate , invTime , ClientID , GrandTolal , inOut  , Notes,ShiftMoveID ,PaymentMethodID)
					 values(@invid ,@invType ,@invDate ,@invTime ,@clientID ,@value , 'in'  ,@note,@shiftmoveID  ,@PaymentMethodID)
	end

	else if @invType =N'م.مبيعات'
	begin
			insert into TblCashMove( invID , invType , invDate , invTime , ClientID , GrandTolal , inOut  , Notes,ShiftMoveID ,PaymentMethodID)
					 values(@invid ,@invType ,@invDate ,@invTime ,@clientID ,@value , 'out'  ,@note,@shiftmoveID  ,@PaymentMethodID)
	end


END