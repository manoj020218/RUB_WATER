#include "modbus_crc.h"

int main(void)
{
	uint8_t cmd[8] = {0x01,0x05,0,0,0,0,0,0}; 
	uint16_t crc;
	uint8_t i;

while (1)
  {
   
		for(i=0;i<8;i++){
			cmd[2] = 0;
			cmd[3] = i;
			cmd[4] = 0xFF;
			cmd[5] = 0;
			crc = ModbusCRC_CheckTable(cmd,6);
			cmd[6] = crc & 0xFF;
			cmd[7] = crc >> 8;
			HAL_UART_Transmit(&huart1, cmd, 8, 10);
			HAL_Delay(200);
		}
		
		for(i=0;i<8;i++){
			cmd[2] = 0;
			cmd[3] = i;
			cmd[4] = 0;
			cmd[5] = 0;
			crc = ModbusCRC_CheckTable(cmd,6);
			cmd[6] = crc & 0xFF;
			cmd[7] = crc >> 8;
			HAL_UART_Transmit(&huart1, cmd, 8, 10);
			HAL_Delay(200);
		}
  }

}
